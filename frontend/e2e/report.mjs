// Running one journey at one size, and the markdown report of a run (docs/e2e.md).
//
// A journey is a list of steps. A step passes when its actions and checks
// do; once one fails, the rest are skipped, since each builds on the last.
// Every page a journey opens or navigates to, and the page each step ends
// on, must not scroll sideways (Page.checkScroll).
// Each step leaves a screenshot. A journey also fails on a console error or a
// request that fails outright or answers 5xx, unless the journey says it
// expects that one; other 4xx answers are listed without failing it, since
// the app answers 401, 403 and 404 by design in places.
import path from 'node:path';

export const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];

export function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

const matches = (pattern, value) => (pattern instanceof RegExp ? pattern.test(value) : String(value).includes(pattern));

/** Sort what a page recorded into what fails the journey, what it expected, and the 4xx answers it only lists. */
export function classify({ consoleErrors, failedRequests }, { requests = [], console: consoles = [] } = {}) {
  const expectedRequest = (request) => requests.find((rule) => matches(rule.url, request.url)
    && (rule.status === undefined || rule.status === request.status));
  const sorted = { consoleErrors: [], failedRequests: [], clientErrors: [], expected: [] };
  for (const error of consoleErrors) {
    const rule = consoles.find((item) => matches(item.text, error.text));
    if (rule) sorted.expected.push({ ...error, why: rule.why });
    else sorted.consoleErrors.push(error);
  }
  for (const request of failedRequests) {
    const rule = expectedRequest(request);
    if (rule) sorted.expected.push({ ...request, why: rule.why });
    else if (request.status === null || request.status >= 500) sorted.failedRequests.push(request);
    else sorted.clientErrors.push(request);
  }
  return sorted;
}

export function journeyFailed(result) {
  return result.steps.some((step) => step.status === 'failed') || result.consoleErrors.length > 0 || result.failedRequests.length > 0;
}

/** Run a journey at one viewport in a page of its own; returns its result for the report. */
export async function runJourney(journey, { browser, viewport, fixtures, api, web, out }) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.checkScroll = true;
  const expectations = { requests: [], console: [] };
  const result = {
    journey: journey.name, title: journey.title, viewport: viewport.name, size: `${viewport.width}x${viewport.height}`,
    steps: [], consoleErrors: [], failedRequests: [], clientErrors: [], expected: [], ms: 0,
  };
  const started = Date.now();
  let stopped = false;

  async function step(name, action) {
    const entry = { name, status: 'skipped' };
    result.steps.push(entry);
    if (stopped) return;
    page.step = name;
    const begun = Date.now();
    try {
      await action();
      await page.expectNoHorizontalScroll();
      entry.status = 'passed';
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.message;
      stopped = true;
    }
    entry.ms = Date.now() - begun;
    const file = `${journey.name}-${viewport.name}-${String(result.steps.length).padStart(2, '0')}-${slug(name)}.png`;
    try {
      await page.screenshot(path.join(out, 'screenshots', file), { fullPage: entry.status === 'failed' });
      entry.screenshot = `screenshots/${file}`;
    } catch (error) {
      entry.screenshotError = error.message;
    }
  }

  const context = {
    page, step, fixtures, viewport, api, web, out,
    url: (route) => `${web}${route}`,
    /** A request this journey makes fail on purpose, such as a refused action. */
    expectRequest: (url, status, why) => expectations.requests.push({ url, status, why }),
    /** A console error the app logs by design here. */
    expectConsole: (text, why) => expectations.console.push({ text, why }),
  };
  try {
    await journey.run(context);
  } catch (error) {
    result.steps.push({ name: 'The journey script', status: 'failed', error: error.message });
  }
  Object.assign(result, classify(page.drain(), expectations));
  result.dialogs = page.dialogs;
  result.ms = Date.now() - started;
  await page.close();
  return result;
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function summary(result) {
  if (!result) return 'not run';
  const failed = result.steps.findIndex((item) => item.status === 'failed');
  if (failed >= 0) return `FAIL at step ${failed + 1} of ${result.steps.length}`;
  if (journeyFailed(result)) return `FAIL: ${result.consoleErrors.length} console errors, ${result.failedRequests.length} failed requests`;
  return `PASS (${result.steps.length} steps, ${seconds(result.ms)})`;
}

function listing(title, items, line) {
  if (!items.length) return [];
  return [`**${title} (${items.length})**`, '', ...items.map((item) => `- ${line(item)}`), ''];
}

/** The run as markdown: a table of journeys by size, then every step with its screenshot, errors and requests. */
export function renderReport(results, { commit = 'unknown', api = '', web = '', now = new Date() } = {}) {
  const journeys = [...new Map(results.map((result) => [result.journey, result.title])).entries()];
  const sizes = VIEWPORTS.filter((viewport) => results.some((result) => result.viewport === viewport.name));
  const passed = results.filter((result) => !journeyFailed(result)).length;
  const lines = [
    '# E2E report',
    '',
    `Commit \`${commit}\` · ${now.toISOString()} · ${passed} of ${results.length} journey runs passed.`,
    '',
    `The app ran as \`next dev\` (${web}) on the E2E API (${api}): the real backend on the strict fake Supabase with`,
    'the demo dataset of backend/scripts/e2e_seed.py, reset before every journey. The shared database is not covered (docs/e2e.md).',
    '',
    `| Journey | ${sizes.map((size) => `${size.name} ${size.width}x${size.height}`).join(' | ')} |`,
    `|---|${sizes.map(() => '---').join('|')}|`,
    ...journeys.map(([name, title]) => `| ${title} | ${sizes.map((size) => summary(results.find((result) => result.journey === name && result.viewport === size.name))).join(' | ')} |`),
    '',
  ];
  for (const result of results) {
    lines.push(`## ${result.title} · ${result.viewport} ${result.size} · ${journeyFailed(result) ? 'FAIL' : 'PASS'}`, '');
    lines.push('| # | Step | Result | Time | Screenshot |', '|---|---|---|---|---|');
    result.steps.forEach((item, index) => {
      const outcome = item.status === 'failed' ? `FAIL: ${cell(item.error)}` : item.status;
      const shot = item.screenshot ? `[screenshot](${item.screenshot})` : '';
      lines.push(`| ${index + 1} | ${cell(item.name)} | ${outcome} | ${item.ms === undefined ? '' : seconds(item.ms)} | ${shot} |`);
    });
    lines.push('');
    lines.push(...listing('Console errors', result.consoleErrors, (error) => `${error.step ? `"${error.step}": ` : ''}${error.kind}: ${cell(error.text).slice(0, 400)}${error.url ? ` (${error.url})` : ''}`));
    lines.push(...listing('Failed requests', result.failedRequests, (request) => `${request.step ? `"${request.step}": ` : ''}${request.method} ${request.url} → ${request.status ?? request.error}`));
    lines.push(...listing('Other 4xx answers (not failures)', result.clientErrors, (request) => `${request.step ? `"${request.step}": ` : ''}${request.method} ${request.url} → ${request.status}`));
    lines.push(...listing('Expected', result.expected, (item) => `${item.step ? `"${item.step}": ` : ''}${item.method ? `${item.method} ${item.url} → ${item.status}` : cell(item.text).slice(0, 200)} (${item.why})`));
    if (!result.consoleErrors.length && !result.failedRequests.length) lines.push('No console errors or failed requests.', '');
  }
  return `${lines.join('\n')}\n`;
}
