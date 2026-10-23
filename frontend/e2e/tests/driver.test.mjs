// The browser driver (e2e/driver.mjs): its ports and Chrome flags, then the
// driver itself in headless Chrome on a page of its own. Skipped without Chrome.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { assertAllowedPort, Browser, chromeArguments, css, findChrome, freePort, label, REFUSED_PORTS, role, text } from '../driver.mjs';

const run = promisify(execFile);

const FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Driver fixture</title>
<style>
  body { margin: 0; font: 16px sans-serif; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  #cover { position: fixed; left: 0; top: 0; width: 220px; height: 60px; background: #ccc; }
  #covered { position: fixed; left: 10px; top: 10px; }
  #covered-field { position: fixed; left: 120px; top: 10px; width: 80px; }
  #covered-kind { position: fixed; left: 120px; top: 36px; width: 80px; }
</style></head>
<body>
  <main style="padding-top: 80px">
    <h1>Driver fixture</h1>
    <a href="#lena">View profile<span class="sr-only">: Lena Park</span></a>
    <div role="group" aria-label="Account type"><button type="button">Tenant <small>Rent a home</small></button><button type="button">Landlord</button></div>
    <form aria-label="Sign up">
      <label for="email">Email</label><input id="email" type="email">
      <label>Password <input id="password" type="password"></label>
      <input id="message" aria-label="Message">
      <textarea id="description" placeholder="Describe the property..."></textarea>
      <label for="rooms">Bedrooms</label><input id="rooms" type="number">
      <label for="day">Day</label><input id="day" type="date">
      <label for="kind">Search for</label><select id="kind"><option value="profiles">Profiles</option><option value="properties">Properties</option></select>
      <input id="file" type="file" class="sr-only" aria-label="File for Bank statement">
      <button type="submit">Send</button>
      <button type="button" disabled>Not yet</button>
    </form>
    <p role="status" id="out"></p>
    <ul><li>First item</li><li>Second <b>item</b></li></ul>
  </main>
  <button id="covered" type="button">Hidden behind</button>
  <input id="covered-field" aria-label="Covered field"><select id="covered-kind" aria-label="Covered kind"><option>One</option></select>
  <div id="cover"></div>
  <script>
    const out = document.getElementById('out');
    document.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = (id) => document.getElementById(id).value;
      out.textContent = 'sent ' + [value('email'), value('password'), value('message'), value('description'), value('rooms'), value('day'), value('kind')].join('|');
    });
    for (const button of document.querySelectorAll('[role=group] button')) {
      button.addEventListener('click', () => { out.textContent = 'picked ' + button.firstChild.textContent.trim(); });
    }
    document.getElementById('file').addEventListener('change', (event) => { out.textContent = 'file ' + event.target.files[0].name; });
  </script>
</body></html>`;

const NOISY = `<!doctype html><html><body><p>Noisy</p><script>
  console.error('Something broke');
  fetch('/missing');
  fetch('http://127.0.0.1:CLOSED/refused').catch(() => {});
</script></body></html>`;

// A phone lays out a page without a viewport tag 980px wide, as Chrome does; the app's pages have the tag.
const WIDE = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>'
  + '<body style="margin:0"><div id="banner" style="width:2000px;height:20px"></div></body></html>';

describe('ports and flags', () => {
  it('never hands out or accepts the developer\'s ports', async () => {
    for (let index = 0; index < 20; index += 1) assert.equal(REFUSED_PORTS.has(await freePort()), false);
    assert.throws(() => assertAllowedPort(3000), /never uses 3000 or 8000/);
    assert.throws(() => assertAllowedPort('8000'), /never uses 3000 or 8000/);
    assert.equal(assertAllowedPort(51234), 51234);
  });

  it('runs Chrome headless, on a throwaway profile, reaching no host but this machine', () => {
    const flags = chromeArguments({ port: 9333, profile: '/tmp/profile-x' });
    assert.ok(flags.includes('--headless=new'));
    assert.ok(flags.includes('--remote-debugging-port=9333'));
    assert.ok(flags.includes('--remote-debugging-address=127.0.0.1'));
    assert.ok(flags.includes('--user-data-dir=/tmp/profile-x'));
    assert.ok(flags.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'));
    assert.ok(!chromeArguments({ port: 1, profile: '/p', headless: false }).includes('--headless=new'));
  });
});

let chrome = null;
try {
  chrome = findChrome();
} catch {
  chrome = null;
}

describe('the driver in Chrome', { skip: chrome ? false : 'Google Chrome is not installed' }, () => {
  let browser;
  let server;
  let base;
  let folder;

  before(async () => {
    const closed = await freePort();
    server = createServer((request, response) => {
      const pages = { '/': FIXTURE, '/noisy': NOISY.replace('CLOSED', String(closed)), '/wide': WIDE };
      const page = pages[request.url];
      response.writeHead(page ? 200 : 404, { 'content-type': 'text/html' }).end(page ?? 'missing');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    folder = await mkdtemp(path.join(tmpdir(), 'tenantvoice-e2e-driver-'));
    browser = await Browser.launch({ executable: chrome });
  });

  after(async () => {
    await browser?.close();
    server?.close();
    await rm(folder, { recursive: true, force: true });
  });

  it('finds elements by role and name, by label and by text', async () => {
    const page = await browser.newPage();
    await page.open(`${base}/`);
    // Visually hidden text names a link without a space before it ("View profile: Lena Park").
    assert.ok(await page.exists(role('link', 'View profile: Lena Park')));
    assert.ok(await page.exists(role('heading', 'Driver fixture', { level: 1 })));
    assert.ok(!(await page.exists(role('heading', 'Driver fixture', { level: 2 }))));
    assert.ok(await page.exists(role('button', /^Tenant/, { within: role('group', 'Account type') })));
    assert.ok(await page.exists(label('Password')));
    assert.ok(await page.exists(label('Message')));
    assert.ok(await page.exists(label('Describe the property...')));
    assert.ok(await page.exists(role('form', 'Sign up')));
    assert.equal(await page.text(text('Second item')), 'Second item');
    assert.ok(!(await page.exists(role('button', 'Hidden behind', { within: role('form', 'Sign up') }))));
    await assert.rejects(page.waitFor(role('button', 'Nowhere'), { timeout: 300 }), /waiting for button "Nowhere": none matched; visible ones read: .*"Send"/);
    await page.close();
  });

  it('clicks, types, picks, uploads and presses keys as a person does', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, mobile: true });
    await page.open(`${base}/`);
    await page.click(role('button', /^Landlord/, { within: role('group', 'Account type') }));
    await page.waitFor(text('picked Landlord'));
    await page.fill(label('Email'), 'tara@e2e.test');
    await page.fill(label('Password'), 'not-this');
    await page.fill(label('Password'), 'Demo-pass-2026');
    await page.fill(label('Message'), 'Hello there');
    await page.fill(label('Describe the property...'), 'Sunny');
    await page.fill(label('Bedrooms'), '3');
    await page.fill(label('Day'), '2026-11-02');
    await page.choose(label('Search for'), 'Properties');
    assert.equal(await page.value(label('Search for')), 'properties');
    await page.click(label('Message'));
    await page.press('Enter');
    await page.waitForText('sent tara@e2e.test|Demo-pass-2026|Hello there|Sunny|3|2026-11-02|properties');
    const file = path.join(folder, 'statement.pdf');
    await writeFile(file, '%PDF-1.4\n');
    await page.upload(label('File for Bank statement'), file);
    await page.waitForText('file statement.pdf');
    await assert.rejects(page.click(role('button', 'Not yet'), { timeout: 300 }), /it is disabled/);
    await assert.rejects(page.click(css('#covered'), { timeout: 500 }), /stays covered by div#cover/);
    // A field behind an overlay takes no typing and no pick: a person could not reach it either.
    await assert.rejects(page.fill(label('Covered field'), 'typed', { timeout: 500 }), /Could not fill .*stays covered by div#cover/);
    await assert.rejects(page.choose(label('Covered kind'), 'One', { timeout: 500 }), /Could not choose in .*stays covered by div#cover/);
    assert.equal(await page.value(label('Covered field')), '');
    await page.close();
  });

  it('records console errors and failed requests with the step they happened in', async () => {
    const page = await browser.newPage();
    page.step = 'Open the noisy page';
    await page.open(`${base}/noisy`);
    await page.waitForIdle();
    const { consoleErrors, failedRequests } = page.drain();
    assert.ok(consoleErrors.some((error) => error.kind === 'console.error' && error.text === 'Something broke' && error.step === 'Open the noisy page'));
    assert.ok(failedRequests.some((request) => request.url === `${base}/missing` && request.status === 404));
    assert.ok(failedRequests.some((request) => request.status === null && /ERR_CONNECTION_REFUSED/.test(request.error)));
    assert.deepEqual(page.drain(), { consoleErrors: [], failedRequests: [] });
    await page.close();
  });

  it('fails a page that scrolls sideways, naming what sticks out', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, mobile: true });
    await page.open(`${base}/wide`);
    await assert.rejects(page.expectNoHorizontalScroll(), /scrolls sideways: 2000px wide in a 390px viewport\. Wider: div#banner/);
    await page.open(`${base}/`);
    await page.expectNoHorizontalScroll();
    // A journey's page checks every page it opens or is sent to.
    page.checkScroll = true;
    await assert.rejects(page.open(`${base}/wide`), /scrolls sideways/);
    await page.open(`${base}/`);
    await page.evaluate(() => { location.href = '/wide'; });
    await assert.rejects(page.waitForUrl('/wide'), /scrolls sideways/);
    await page.close();
  });

  it('keeps each page in its own browser context', async () => {
    const first = await browser.newPage();
    await first.open(`${base}/`);
    await first.evaluate(() => localStorage.setItem('tv_token', 'first'));
    const second = await browser.newPage();
    await second.open(`${base}/`);
    assert.equal(await second.evaluate(() => localStorage.getItem('tv_token')), null);
    await first.close();
    await second.close();
  });

  it('leaves no Chrome or profile behind when Node exits without closing it', async () => {
    const driver = new URL('../driver.mjs', import.meta.url).href;
    const script = `import { Browser } from ${JSON.stringify(driver)};
      const browser = await Browser.launch({ executable: ${JSON.stringify(chrome)} });
      console.log(JSON.stringify({ pid: browser.process.pid, profile: browser.profile }));
      process.exit(0);`;
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { timeout: 30_000 });
    const { pid, profile } = JSON.parse(stdout);
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let tries = 0; alive() && tries < 50; tries += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(alive(), false, `Chrome ${pid} outlived the process that started it`);
    assert.equal(existsSync(profile), false);
  });

  it('saves a screenshot of the viewport, or of the whole page', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 300 });
    await page.open(`${base}/`);
    const shot = await page.screenshot(path.join(folder, 'viewport.png'), { fullPage: false });
    assert.ok(existsSync(shot));
    const full = await page.screenshot(path.join(folder, 'full.png'));
    const height = (file) => import('node:fs').then((fs) => fs.readFileSync(file).readUInt32BE(20));
    assert.equal(await height(shot), 300);
    assert.ok(await height(full) > 300);
    await page.close();
  });
});
