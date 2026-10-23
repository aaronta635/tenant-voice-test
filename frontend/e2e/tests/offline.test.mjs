// The run's `next dev` reaches nothing outside this machine (e2e/offline.mjs, e2e/fonts.mjs), and its servers
// get none of the shell's keys (run.mjs cleanEnv).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { callOptions, fontCalls, mockStylesheet, writeFontMocks } from '../fonts.mjs';
import { cleanEnv } from '../run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..', '..');
const OFFLINE = pathToFileURL(path.join(HERE, '..', 'offline.mjs')).href;
const run = promisify(execFile);

/** Run a script under the offline preload, as next dev runs; returns what it printed. */
async function offline(script) {
  const { stdout } = await run(process.execPath, [`--import=${OFFLINE}`, '--input-type=module', '-e', script], { timeout: 20_000 });
  return stdout.trim();
}

describe('the offline preload', () => {
  // Names that can never resolve (.invalid): were the preload broken, nothing real would be reached.
  it('refuses fetch, sockets and https to other machines before any lookup', async () => {
    const printed = await offline(`
      import net from 'node:net';
      import https from 'node:https';
      const fetched = await fetch('https://registry.example.invalid/-/package/next/dist-tags').then(() => 'fetched', (error) => error.message);
      const socket = await new Promise((resolve) => net.connect({ host: 'fonts.example.invalid', port: 443 }).on('error', (error) => resolve(error.code)).on('connect', () => resolve('connected')));
      const secure = await new Promise((resolve) => https.get('https://www.example.invalid/', () => resolve('answered')).on('error', (error) => resolve(error.code)));
      console.log(JSON.stringify([fetched, socket, secure]));
    `);
    const [fetched, socket, secure] = JSON.parse(printed);
    assert.match(fetched, /E2E: no requests outside this machine \(registry\.example\.invalid\)/);
    assert.equal(socket, 'ECONNREFUSED');
    assert.equal(secure, 'ECONNREFUSED');
  });

  it('still reaches this machine', async () => {
    const server = createServer((request, response) => response.end('local'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const printed = await offline(`console.log(await (await fetch('http://127.0.0.1:${server.address().port}/')).text());`);
      assert.equal(printed, 'local');
    } finally {
      server.close();
    }
  });
});

describe('the Google Fonts mocks', () => {
  it('reads the options of each next/font/google call', () => {
    const source = `import { Inter, Roboto_Mono as Mono } from "next/font/google";
      const inter = Inter({ variable: '--font-sans', subsets: ["latin"], display: "swap", });
      const mono = Mono({ weight: ["400", "700"], subsets: ['latin'] });`;
    assert.deepEqual(fontCalls(source), [
      ['Inter', { variable: '--font-sans', subsets: ['latin'], display: 'swap' }],
      ['Roboto_Mono', { weight: ['400', '700'], subsets: ['latin'] }],
    ]);
    assert.equal(callOptions('const a = Inter({ subsets: [someList] })', 'Inter'), null);
  });

  it('answers every font the app loads with a stylesheet that downloads nothing', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'tenantvoice-e2e-fonts-'));
    try {
      const file = path.join(folder, 'google-fonts.cjs');
      const urls = await writeFontMocks(FRONTEND, file);
      assert.deepEqual(urls.sort(), [
        'https://fonts.googleapis.com/css2?family=Archivo:wght@100..900&display=swap',
        'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap',
      ]);
      const written = await readFile(file, 'utf8');
      assert.match(written, /^module\.exports = \{/);
      assert.doesNotMatch(written, /src: url\(/);
      assert.match(mockStylesheet('Inter'), /\/\* latin \*\/\n@font-face \{\n {2}font-family: 'Inter';/);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe('the servers environment', () => {
  it('passes what a process needs and nothing else, so no key of the shell reaches them', () => {
    const env = cleanEnv({ NEXT_PUBLIC_API_URL: 'http://127.0.0.1:1/api/v1' }, {
      PATH: '/usr/bin', HOME: '/home/someone', SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'secret', DEEPSEEK_API_KEY: 'secret', NODE_OPTIONS: '--inspect',
    });
    assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/home/someone', NEXT_PUBLIC_API_URL: 'http://127.0.0.1:1/api/v1' });
  });
});
