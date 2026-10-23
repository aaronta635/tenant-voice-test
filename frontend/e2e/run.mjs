#!/usr/bin/env node
// The browser journeys (tracker R44, docs/e2e.md). Starts the E2E API
// (backend/scripts/e2e_server.py: the real app on the strict fake Supabase,
// with demo data) and `next dev` on free ports, drives Chrome through each
// journey at phone and desktop sizes, and writes screenshots and a report
// under e2e/out/. Exits non-zero when a journey fails.
//
//   npm run e2e
//   npm run e2e -- --only tenant,admin --viewport phone
//   npm run e2e -- --explore /tenant/dashboard --as tenant
//
// Neither server is ever on 3000 or 8000, and neither reaches another machine.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertAllowedPort, Browser, freePort } from './driver.mjs';
import { writeFontMocks } from './fonts.mjs';
import { JOURNEYS } from './journeys/index.mjs';
import { journeyFailed, renderReport, runJourney, VIEWPORTS } from './report.mjs';
import { signIn } from './journeys/support.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const BACKEND = path.resolve(FRONTEND, '..', 'backend');
// The environment the servers get: what a process needs to run, and nothing
// else, so no key or project URL of the shell reaches them.
const PASSED_ENV = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'SystemRoot'];
// Left in every output folder a run makes, so the next run knows the folder is its own to empty.
export const OUT_MARKER = '.tenantvoice-e2e-out';

const children = [];

/** The servers' environment: PASSED_ENV from this one, then extra. */
export function cleanEnv(extra = {}, from = process.env) {
  const env = {};
  for (const name of PASSED_ENV) if (from[name] !== undefined) env[name] = from[name];
  return { ...env, ...extra };
}

/**
 * Empty the output folder for a run, and mark it as the run's. Only a folder a run made is emptied: the
 * default e2e/out, a new or empty one, or one holding OUT_MARKER. Any other refuses, so `--out ~/Desktop`
 * deletes nothing.
 */
export async function prepareOut(out, { isDefault = false } = {}) {
  const entries = await readdir(out).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (entries.length && !isDefault && !entries.includes(OUT_MARKER)) {
    throw new Error(`${out} holds files no E2E run made: give --out a new or empty folder, so nothing in it is deleted`);
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, 'screenshots'), { recursive: true });
  await writeFile(path.join(out, OUT_MARKER), 'Made by frontend/e2e/run.mjs: the next run empties this folder.\n');
}

/** The backend's Python: E2E_PYTHON, this checkout's venv, the main checkout's venv, then python3. */
export function findPython(env = process.env) {
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: FRONTEND, encoding: 'utf8' });
  const main = common.status === 0 ? path.dirname(common.stdout.trim()) : null;
  const candidates = [
    env.E2E_PYTHON,
    path.join(BACKEND, '.venv', 'bin', 'python'),
    main && path.join(main, 'backend', '.venv', 'bin', 'python'),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? 'python3';
}

function start(name, command, args, { cwd, env, log }) {
  const output = openSync(log, 'a');
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', output, output] });
  child.label = name;
  child.log = log;
  child.exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve(code ?? signal)));
  children.push(child);
  return child;
}

async function stopAll() {
  const running = children.filter((child) => child.exitCode === null && child.signalCode === null);
  for (const child of running) {
    try {
      process.kill(-child.pid, 'SIGTERM'); // the process group: next dev's workers too
    } catch {
      // already gone
    }
  }
  await Promise.race([Promise.all(running.map((child) => child.exited)), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  for (const child of running) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

async function waitUntilUp(child, url, timeout, accept = (response) => response.ok) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const tail = (await readFile(child.log, 'utf8').catch(() => '')).trim().split('\n').slice(-12).join('\n');
      throw new Error(`${child.label} exited before it answered (${child.log}):\n${tail}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'manual' });
      if (accept(response)) return response;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${child.label} did not answer ${url} within ${timeout / 1000}s; see its log`);
}

/** A fresh copy of the demo dataset; returns its fixtures. */
async function resetData(api) {
  const response = await fetch(`${api}/e2e/reset`, { method: 'POST' });
  if (!response.ok) throw new Error(`The E2E API could not make the demo data again (${response.status}); see backend.log`);
  return response.json();
}

/** Compile each route once before the journeys, so a first visit does not time out while next dev builds it. */
async function warmUp(base, journeys) {
  const visits = new Map();
  for (const journey of journeys) {
    for (const route of journey.routes ?? []) visits.set(`${journey.workspace ?? ''} ${route}`, [route, journey.workspace]);
  }
  for (const [route, workspace] of visits.values()) {
    const headers = workspace ? { cookie: `tv_token=e2e-warm-up; tv_role=${workspace}` } : {};
    await fetch(`${base}${route}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(180_000) }).catch(() => {});
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      viewport: { type: 'string', default: 'both' },
      headed: { type: 'boolean', default: false },
      explore: { type: 'string' },
      as: { type: 'string' },
      keep: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  const selected = values.only ? values.only.split(',').map((name) => name.trim()) : JOURNEYS.map((journey) => journey.name);
  const unknown = selected.filter((name) => !JOURNEYS.some((journey) => journey.name === name));
  if (unknown.length) throw new Error(`Unknown journey ${unknown.join(', ')}; there are ${JOURNEYS.map((journey) => journey.name).join(', ')}`);
  const journeys = JOURNEYS.filter((journey) => selected.includes(journey.name));
  const viewports = values.viewport === 'both' ? VIEWPORTS : VIEWPORTS.filter((viewport) => viewport.name === values.viewport);
  if (!viewports.length) throw new Error('--viewport is phone, desktop or both');

  const out = path.resolve(values.out ?? path.join(HERE, 'out'));
  await prepareOut(out, { isDefault: out === path.join(HERE, 'out') });

  const apiPort = assertAllowedPort(await freePort());
  const webPort = assertAllowedPort(await freePort());
  const api = `http://127.0.0.1:${apiPort}`;
  const web = `http://127.0.0.1:${webPort}`;
  const fonts = path.join(out, 'google-fonts.cjs');
  await writeFontMocks(FRONTEND, fonts);

  console.log(`E2E API ${api} · frontend ${web} · output ${out}`);
  const backend = start('The E2E API', findPython(), ['-m', 'scripts.e2e_server', '--port', String(apiPort), '--frontend-origin', web], {
    cwd: BACKEND, env: cleanEnv({ PYTHONDONTWRITEBYTECODE: '1' }), log: path.join(out, 'backend.log'),
  });
  const frontend = start('next dev', process.execPath, [path.join(FRONTEND, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(webPort), '-H', '127.0.0.1'], {
    cwd: FRONTEND,
    env: cleanEnv({
      NEXT_PUBLIC_API_URL: `${api}/api/v1`,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fonts,
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(HERE, 'offline.mjs')).href}`,
    }),
    log: path.join(out, 'frontend.log'),
  });

  let browser;
  try {
    await waitUntilUp(backend, `${api}/e2e/fixtures`, 60_000);
    await waitUntilUp(frontend, `${web}/`, 180_000, (response) => response.status < 500);
    if (values.explore) {
      browser = await Browser.launch({ headless: !values.headed });
      await explore(browser, { api, web, out, path: values.explore, as: values.as, viewport: viewports[0] });
      return 0;
    }
    console.log('Compiling the journeys\' pages...');
    await warmUp(web, journeys);
    browser = await Browser.launch({ headless: !values.headed });
    const results = [];
    for (const viewport of viewports) {
      for (const journey of journeys) {
        const fixtures = await resetData(api);
        const result = await runJourney(journey, { browser, viewport, fixtures, api, web, out });
        results.push(result);
        console.log(`${journeyFailed(result) ? 'FAIL' : 'PASS'}  ${journey.name} at ${viewport.width}x${viewport.height}`);
      }
    }
    const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: FRONTEND, encoding: 'utf8' }).stdout.trim();
    await writeFile(path.join(out, 'report.md'), renderReport(results, { commit, api, web }));
    await writeFile(path.join(out, 'report.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log(`Report: ${path.join(out, 'report.md')}`);
    if (values.keep) {
      console.log(`Servers left running: ${web} (API ${api}). Ctrl+C stops them.`);
      await new Promise(() => {});
    }
    return results.some(journeyFailed) ? 1 : 0;
  } finally {
    await browser?.close();
    await stopAll();
  }
}

/** Open one page, signed in as a demo account if asked, and print what a journey can find on it. */
async function explore(browser, { api, web, out, path: route, as, viewport }) {
  const fixtures = await resetData(api);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  if (as) await signIn(page, web, fixtures, as);
  await page.open(`${web}${route}`);
  const file = path.join(out, 'screenshots', `explore-${viewport.name}.png`);
  await page.screenshot(file, { fullPage: true });
  for (const item of await page.outline()) {
    if (item.visible) console.log([item.tag, item.role, item.type, item.id && `#${item.id}`, JSON.stringify(item.name)].filter(Boolean).join(' '));
  }
  console.log(JSON.stringify(page.drain(), null, 2));
  console.log(`URL ${await page.url()} · screenshot ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stop = async (signal) => {
    await stopAll();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  main().then((code) => process.exit(code), async (error) => {
    console.error(error.stack ?? error.message);
    await stopAll();
    process.exit(1);
  });
}
