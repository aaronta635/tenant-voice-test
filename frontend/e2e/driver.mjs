// A small browser driver for the E2E journeys (docs/e2e.md): Node's own fetch
// and WebSocket drive headless Chrome over the DevTools protocol, so the suite
// needs no package. Chrome runs with a throwaway profile, reaches no host but
// this machine (--host-resolver-rules), and each page lives in its own browser
// context, so journeys share no cookies or storage.
//
// Elements are found as a person finds them: by role and accessible name, by
// label, or by text (role(), label(), text()), with css() as the way out.
// Every action waits for its element to be visible, enabled and on top
// before it clicks, types or picks, with real input events where a person
// would make them.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The developer's own frontend and API: the suite never binds or calls them. */
export const REFUSED_PORTS = new Set([3000, 8000]);
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const ACTION_TIMEOUT = 20_000;
const NAVIGATION_TIMEOUT = 120_000;
const POLL_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The promise, or a rejection with message after ms; the timer goes either way, so it never keeps Node running. */
export function withTimeout(promise, ms, message) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------
// A name may be text or a RegExp, which is sent to the page as its source and flags.
const matcher = (value) => (value instanceof RegExp ? { regex: value.source, flags: value.flags } : value);
const shown = (value) => (value && typeof value === 'object' ? `/${value.regex}/${value.flags}` : `"${value}"`);

/** An element by ARIA role and accessible name: exact names win, else the name is a part of it (any case). */
export const role = (name, accessibleName, options = {}) => ({ role: name, name: matcher(accessibleName), ...options });
/** A form control by its label (label element, aria-label or aria-labelledby, then placeholder). */
export const label = (value, options = {}) => ({ label: matcher(value), ...options });
/** The innermost visible element whose text holds this text (any case); an exact match wins. */
export const text = (value, options = {}) => ({ text: matcher(value), ...options });
/** Elements a CSS selector matches. */
export const css = (selector, options = {}) => ({ css: selector, ...options });

export function describe(locator) {
  const where = locator.within ? ` in ${describe(locator.within)}` : '';
  const nth = locator.nth ? ` (#${locator.nth + 1})` : '';
  if (locator.role) return `${locator.role}${locator.name !== undefined ? ` ${shown(locator.name)}` : ''}${nth}${where}`;
  if (locator.label) return `field ${shown(locator.label)}${nth}${where}`;
  if (locator.text) return `text ${shown(locator.text)}${nth}${where}`;
  return `css ${locator.css}${nth}${where}`;
}

// Runs in the page: the element a locator names, or why there is none. Kept
// free of outside references, since it is sent to the page as source.
function findInPage(locator) {
  const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const fold = (value) => norm(value).toLowerCase();
  const BLOCKS = new Set(['block', 'flex', 'grid', 'list-item', 'table', 'table-row', 'table-cell']);

  function visible(element) {
    if (!element.isConnected) return false;
    if (element.checkVisibility && !element.checkVisibility({ visibilityProperty: true })) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }
  function hiddenFromTree(element) {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.getAttribute('aria-hidden') === 'true' || node.hidden || node.inert) return true;
    }
    return false;
  }
  function contentText(node, skip) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || node === skip) return '';
    const element = node;
    if (element.getAttribute('aria-hidden') === 'true') return '';
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'].includes(element.tagName)) return '';
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    if (element.hasAttribute('aria-label') && norm(element.getAttribute('aria-label'))) {
      return ` ${element.getAttribute('aria-label')} `;
    }
    if (element.tagName === 'IMG') return ` ${element.getAttribute('alt') ?? ''} `;
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return ` ${element.value ?? ''} `;
    if (element.tagName === 'SELECT') return ` ${element.selectedOptions?.[0]?.textContent ?? ''} `;
    let value = '';
    for (const child of element.childNodes) value += contentText(child, skip);
    return BLOCKS.has(style.display) ? ` ${value} ` : value;
  }
  function implicitRole(element) {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (tag === 'a' || tag === 'area') return element.hasAttribute('href') ? 'link' : null;
    if (tag === 'button' || tag === 'summary') return 'button';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (type === 'hidden' || type === 'file') return null;
      if (element.hasAttribute('list')) return 'combobox';
      return type === 'search' ? 'searchbox' : 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return element.multiple || element.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'option') return 'option';
    if (tag === 'img') return element.getAttribute('alt') === '' ? 'presentation' : 'img';
    if (tag === 'section') return element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') ? 'region' : null;
    return {
      nav: 'navigation', main: 'main', aside: 'complementary', form: 'form', search: 'search', article: 'article',
      dialog: 'dialog', ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row', td: 'cell',
      th: 'columnheader', fieldset: 'group', output: 'status', progress: 'progressbar', header: 'banner',
      footer: 'contentinfo',
    }[tag] ?? null;
  }
  function roleOf(element) {
    return norm(element.getAttribute('role')).split(' ')[0] || implicitRole(element);
  }
  function labelText(element) {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean);
      if (parts.length) return norm(parts.map((part) => contentText(part)).join(' '));
    }
    if (norm(element.getAttribute('aria-label'))) return norm(element.getAttribute('aria-label'));
    if (element.labels?.length) return norm([...element.labels].map((item) => contentText(item, element)).join(' '));
    return '';
  }
  function nameOf(element) {
    const labelled = labelText(element);
    if (labelled) return labelled;
    const tag = element.tagName;
    if (tag === 'INPUT' && ['button', 'submit', 'reset'].includes(element.type)) return norm(element.value);
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return norm(element.getAttribute('placeholder') || element.getAttribute('title'));
    }
    if (tag === 'IMG') return norm(element.getAttribute('alt') || element.getAttribute('title'));
    if (tag === 'FIELDSET') {
      const legend = element.querySelector(':scope > legend');
      if (legend) return norm(contentText(legend));
    }
    if (['dialog', 'alertdialog', 'region', 'navigation', 'form', 'group', 'list', 'table', 'search'].includes(roleOf(element))) {
      return norm(element.getAttribute('title'));
    }
    return norm(contentText(element)) || norm(element.getAttribute('title'));
  }
  // Names compare without their spaces too: visually hidden text (sr-only) is a block, which a
  // name read from the content sets apart with a space ("View profile : Lena").
  const squash = (value) => fold(value).replace(/\s+/g, '');
  function pick(candidates, wanted, readName) {
    if (wanted === undefined || wanted === null) return candidates;
    if (typeof wanted === 'object' && wanted.regex !== undefined) {
      const pattern = new RegExp(wanted.regex, wanted.flags);
      return candidates.filter((element) => pattern.test(readName(element)) || pattern.test(norm(readName(element)).replace(/\s+(?=[:,.;!?])/g, '')));
    }
    const named = candidates.map((element) => [element, readName(element)]);
    const exact = named.filter(([, name]) => fold(name) === fold(wanted) || squash(name) === squash(wanted));
    const chosen = exact.length ? exact : named.filter(([, name]) => fold(name).includes(fold(wanted)) || squash(name).includes(squash(wanted)));
    return chosen.map(([element]) => element);
  }

  let root = document;
  if (locator.within) {
    const found = findInPage(locator.within);
    if (typeof found === 'string') return `its container: ${found}`;
    root = found;
  }
  const all = [...root.querySelectorAll('*')];
  let candidates;
  let readName = nameOf;
  if (locator.role) {
    candidates = all.filter((element) => roleOf(element) === locator.role && !hiddenFromTree(element));
    if (locator.level) candidates = candidates.filter((element) => element.tagName === `H${locator.level}`);
  } else if (locator.label) {
    candidates = all.filter((element) => element.matches(
      'input:not([type=hidden]), select, textarea, [role=textbox], [role=combobox], [role=checkbox], [role=radio], [role=switch], [role=spinbutton], [contenteditable=true]',
    ));
    readName = (element) => labelText(element) || norm(element.getAttribute('placeholder'));
  } else if (locator.text) {
    // textContent holds hidden text too, so it only narrows the search cheaply.
    const rough = typeof locator.text === 'string' ? fold(locator.text) : null;
    candidates = all.filter((element) => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HTML', 'BODY'].includes(element.tagName)
      && (rough === null || fold(element.textContent).includes(rough)));
    readName = (element) => norm(contentText(element));
  } else {
    candidates = [...root.querySelectorAll(locator.css)];
  }
  const shown = locator.hidden ? candidates : candidates.filter(visible);
  let matches = locator.css ? shown : pick(shown, locator.name ?? locator.label ?? locator.text, readName);
  if (locator.text) matches = matches.filter((element) => !matches.some((other) => other !== element && element.contains(other)));
  const chosen = matches[locator.nth ?? 0];
  if (chosen) return chosen;
  if (!matches.length && shown.length && !locator.css) {
    const names = [...new Set(shown.slice(0, 40).map(readName).filter(Boolean))].slice(0, 8);
    return `none matched; visible ones read: ${names.map((name) => JSON.stringify(name.slice(0, 60))).join(', ')}`;
  }
  return matches.length ? `only ${matches.length} matched` : candidates.length ? 'none is visible' : 'none exists';
}

// Runs in the page: the interactive elements and landmarks, as role and name, for --explore.
function outlineInPage() {
  const elements = [...document.querySelectorAll('a[href], button, input, select, textarea, [role], h1, h2, h3, nav, main, form, dialog, section[aria-label], section[aria-labelledby]')];
  return elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), type: element.getAttribute('type'),
      id: element.id || null, name: (element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      visible: box.width > 0 && box.height > 0 };
  });
}

// ---------------------------------------------------------------------------
// Ports and Chrome
// ---------------------------------------------------------------------------
/** A free port on 127.0.0.1, never one of REFUSED_PORTS. */
export async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const { port: chosen } = server.address();
        server.close(() => resolve(chosen));
      });
    });
    if (!REFUSED_PORTS.has(port)) return port;
  }
}

export function assertAllowedPort(port) {
  if (REFUSED_PORTS.has(Number(port))) throw new Error(`Port ${port} is the developer's own app: the E2E suite never uses 3000 or 8000.`);
  return Number(port);
}

export function findChrome(candidates = [process.env.E2E_CHROME, ...CHROME_PATHS]) {
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) throw new Error('Google Chrome was not found: set E2E_CHROME to its executable.');
  return found;
}

/** Chrome's flags: headless, a throwaway profile, no background traffic, and no host but this machine. */
export function chromeArguments({ port, profile, headless = true }) {
  return [
    ...(headless ? ['--headless=new'] : []),
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-domain-reliability',
    '--disable-client-side-phishing-detection',
    '--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,PasswordLeakDetection',
    '--metrics-recording-only',
    '--password-store=basic',
    '--use-mock-keychain',
    '--mute-audio',
    '--hide-scrollbars',
    'about:blank',
  ];
}

async function until(read, timeout, message) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${message}${last ? ` (${last.message})` : ''}`);
}

class Cdp {
  #calls = new Map();
  #handlers = new Set();
  #id = 0;

  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => this.#receive(JSON.parse(event.data)));
    socket.addEventListener('close', () => {
      for (const { reject, method } of this.#calls.values()) reject(new Error(`${method}: Chrome closed the connection`));
      this.#calls.clear();
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.#id;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.#calls.set(id, { resolve, reject, method }));
  }

  on(handler) {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  #receive(message) {
    if (message.id === undefined) {
      for (const handler of this.#handlers) handler(message);
      return;
    }
    const call = this.#calls.get(message.id);
    if (!call) return;
    this.#calls.delete(message.id);
    if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
    else call.resolve(message.result);
  }
}

export class Browser {
  constructor(process, cdp, profile, cleanUp) {
    this.process = process;
    this.cdp = cdp;
    this.profile = profile;
    this.cleanUp = cleanUp;
  }

  /** Start Chrome headless with a new profile on a free DevTools port. */
  static async launch({ executable = findChrome(), headless = true } = {}) {
    const port = await freePort();
    const profile = await mkdtemp(path.join(tmpdir(), 'tenantvoice-e2e-chrome-'));
    const child = spawn(executable, chromeArguments({ port, profile, headless }), { stdio: 'ignore' });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    // A run that ends without close() (a signal, an uncaught error) leaves no Chrome or profile behind.
    const cleanUp = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(profile, { recursive: true, force: true });
    };
    process.once('exit', cleanUp);
    try {
      const version = await Promise.race([
        until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).json(), 30_000, 'Chrome did not start'),
        exited.then((code) => { throw new Error(`Chrome exited (${code}) before it started`); }),
      ]);
      const socket = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new Error('Could not connect to Chrome')), { once: true });
      });
      return new Browser(child, new Cdp(socket), profile, cleanUp);
    } catch (error) {
      process.removeListener('exit', cleanUp);
      child.kill('SIGKILL');
      await rm(profile, { recursive: true, force: true });
      throw error;
    }
  }

  /** A page in a browser context of its own: no cookies or storage shared with other pages. */
  async newPage(options = {}) {
    const { browserContextId } = await this.cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this.cdp, { sessionId, targetId, browserContextId, ...options });
    await page.start();
    return page;
  }

  async close() {
    try {
      await withTimeout(this.cdp.send('Browser.close'), 3_000, 'Chrome did not close');
    } catch {
      // Chrome is already gone.
    }
    this.cdp.socket.close();
    process.removeListener('exit', this.cleanUp);
    if (this.process.exitCode === null) this.process.kill('SIGKILL');
    await rm(this.profile, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
};
// Input types Chrome edits with a picker, not with typed text: their value is set, as a picker would.
const SET_VALUE_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'color', 'range']);

export class Page {
  #inflight = new Map();
  #off;
  #loads = [];

  constructor(cdp, { sessionId, targetId, browserContextId, actionTimeout = ACTION_TIMEOUT }) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.browserContextId = browserContextId;
    this.actionTimeout = actionTimeout;
    /** What a journey's step is doing, recorded with each error. */
    this.step = null;
    /** Check every page open() and waitForUrl() arrive at for sideways scrolling (a journey's pages are). */
    this.checkScroll = false;
    this.consoleErrors = [];
    this.failedRequests = [];
    this.dialogs = [];
  }

  send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async start() {
    this.#off = this.cdp.on((message) => {
      if (message.sessionId === this.sessionId) this.#event(message.method, message.params);
    });
    await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable', 'DOM.enable']
      .map((method) => this.send(method)));
    await this.send('Page.setLifecycleEventsEnabled', { enabled: true });
  }

  #event(method, params) {
    const at = this.step;
    if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
      const message = params.args.map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? '').join(' ');
      const frame = params.stackTrace?.callFrames?.[0];
      this.consoleErrors.push({ step: at, kind: `console.${params.type}`, text: message.slice(0, 2_000), url: frame?.url });
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails;
      this.consoleErrors.push({ step: at, kind: 'exception', text: (details.exception?.description ?? details.text).slice(0, 2_000), url: details.url });
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error' && params.entry.source !== 'network') {
      this.consoleErrors.push({ step: at, kind: `log.${params.entry.source}`, text: params.entry.text.slice(0, 2_000), url: params.entry.url });
    } else if (method === 'Network.requestWillBeSent') {
      this.#inflight.set(params.requestId, { url: params.request.url, method: params.request.method, type: params.type });
    } else if (method === 'Network.responseReceived') {
      const request = this.#inflight.get(params.requestId);
      if (params.response.status >= 400) {
        this.failedRequests.push({ step: at, method: request?.method ?? 'GET', url: params.response.url, status: params.response.status });
      }
    } else if (method === 'Network.loadingFinished') {
      this.#inflight.delete(params.requestId);
    } else if (method === 'Network.loadingFailed') {
      const request = this.#inflight.get(params.requestId);
      this.#inflight.delete(params.requestId);
      if (!params.canceled && params.errorText !== 'net::ERR_ABORTED') {
        this.failedRequests.push({ step: at, method: request?.method ?? 'GET', url: request?.url ?? '', status: null, error: params.errorText });
      }
    } else if (method === 'Page.loadEventFired') {
      for (const resolve of this.#loads.splice(0)) resolve();
    } else if (method === 'Page.javascriptDialogOpening') {
      this.dialogs.push({ step: at, type: params.type, message: params.message });
      this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  }

  /** Phone (mobile: true, touch) or desktop size, in CSS pixels. */
  async setViewport({ width, height, mobile = false }) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  }

  /** Load a URL and wait for its load event and a quiet network. */
  async open(url, { timeout = NAVIGATION_TIMEOUT } = {}) {
    const loaded = new Promise((resolve) => this.#loads.push(resolve));
    const { errorText } = await this.send('Page.navigate', { url });
    if (errorText) throw new Error(`Could not open ${url}: ${errorText}`);
    await withTimeout(loaded, timeout, `${url} did not finish loading in ${timeout / 1000}s`);
    await this.waitForIdle();
    if (this.checkScroll) await this.expectNoHorizontalScroll();
  }

  /** Wait until no request has been in flight for quiet ms (long-lived streams aside). */
  async waitForIdle({ quiet = 400, timeout = 20_000 } = {}) {
    const deadline = Date.now() + timeout;
    let calmSince = Date.now();
    while (Date.now() < deadline) {
      const busy = [...this.#inflight.values()].some((request) => !['EventSource', 'WebSocket', 'Ping'].includes(request.type));
      if (busy) calmSince = Date.now();
      else if (Date.now() - calmSince >= quiet) return;
      await sleep(50);
    }
  }

  async evaluate(fn, ...args) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  async #call(objectId, fn, ...args) {
    const { result, exceptionDetails } = await this.send('Runtime.callFunctionOn', {
      objectId, functionDeclaration: String(fn), arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  /** The element's object id now, or a string saying why there is none. */
  async #find(locator) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression: `(${findInPage})(${JSON.stringify(locator)})`, returnByValue: false,
    });
    if (exceptionDetails) return `the page could not look: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`;
    if (result.subtype === 'node') return { objectId: result.objectId };
    return result.value ?? 'none exists';
  }

  /** Wait for the element; returns its object id. */
  async locate(locator, { timeout = this.actionTimeout, enabled = false } = {}) {
    const deadline = Date.now() + timeout;
    let reason = 'none exists';
    while (Date.now() < deadline) {
      const found = await this.#find(locator);
      if (typeof found !== 'string') {
        if (!enabled) return found.objectId;
        const disabled = await this.#call(found.objectId, function isDisabled() {
          return this.disabled === true || this.getAttribute('aria-disabled') === 'true' || Boolean(this.closest('fieldset:disabled'));
        });
        if (!disabled) return found.objectId;
        reason = 'it is disabled';
      } else {
        reason = found;
      }
      await sleep(POLL_MS);
    }
    throw new Error(`Timed out after ${timeout / 1000}s waiting for ${describe(locator)}: ${reason}`);
  }

  async exists(locator) {
    return typeof (await this.#find(locator)) !== 'string';
  }

  /** Wait for the element, and bring it into view, so the step's screenshot shows it. */
  async waitFor(locator, options) {
    const objectId = await this.locate(locator, options);
    await this.#call(objectId, function reveal() { this.scrollIntoView({ block: 'center', behavior: 'instant' }); }).catch(() => {});
  }

  async waitForGone(locator, { timeout = this.actionTimeout } = {}) {
    await until(async () => !(await this.exists(locator)), timeout, `Timed out waiting for ${describe(locator)} to go`);
  }

  /** Wait for the page's visible text to hold value (any case). */
  async waitForText(value, { timeout = this.actionTimeout } = {}) {
    try {
      await until(() => this.evaluate((wanted) => document.body.innerText.toLowerCase().includes(wanted.toLowerCase()), value),
        timeout, '');
    } catch {
      const shown = (await this.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`Timed out after ${timeout / 1000}s waiting for the text "${value}". The page reads: ${shown}`);
    }
  }

  /** Wait for the URL to match: a RegExp, a string it contains, or a test of it. */
  async waitForUrl(pattern, { timeout = this.actionTimeout } = {}) {
    const test = typeof pattern === 'function' ? pattern
      : (href) => (pattern instanceof RegExp ? pattern.test(href) : href.includes(pattern));
    try {
      await until(async () => test(await this.url()), timeout, '');
    } catch {
      throw new Error(`Timed out after ${timeout / 1000}s waiting for the URL to match ${pattern}; it is ${await this.url()}`);
    }
    if (this.checkScroll) {
      await this.waitForIdle();
      await this.expectNoHorizontalScroll();
    }
  }

  async url() {
    return this.evaluate(() => location.href);
  }

  /** The visible text of the page, or of one element. */
  async text(locator) {
    if (!locator) return this.evaluate(() => document.body.innerText);
    return this.#call(await this.locate(locator), function innerText() { return this.innerText; });
  }

  /** Everything the page holds, inline scripts and the server's payload included. */
  async html() {
    return this.evaluate(() => document.documentElement.outerHTML);
  }

  /** A field's current value. */
  async value(locator) {
    return this.#call(await this.locate(locator), function read() { return this.isContentEditable ? this.textContent : this.value; });
  }

  async #point(objectId, timeout) {
    const deadline = Date.now() + timeout;
    let cover = '';
    while (Date.now() < deadline) {
      const spot = await this.#call(objectId, function spot() {
        this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const box = this.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        const onTop = Boolean(hit) && (hit === this || this.contains(hit) || (hit.closest?.('label') && hit.closest('label').control === this));
        const label = hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${typeof hit.className === 'string' && hit.className ? `.${hit.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}` : 'nothing';
        return { x, y, onTop, cover: label };
      });
      if (spot.onTop) return spot;
      cover = spot.cover;
      await sleep(POLL_MS);
    }
    throw new Error(`it stays covered by ${cover}`);
  }

  /** The element, once it is visible, enabled and on top (nothing covers its centre); where to point at it. */
  async #reach(locator, doing, timeout) {
    const deadline = Date.now() + timeout;
    const objectId = await this.locate(locator, { timeout, enabled: true });
    try {
      return { objectId, spot: await this.#point(objectId, Math.max(1_000, deadline - Date.now())) };
    } catch (error) {
      throw new Error(`Could not ${doing} ${describe(locator)}: ${error.message}`);
    }
  }

  /** Click the element's centre with the mouse, once it is visible, enabled and on top. */
  async click(locator, { timeout = this.actionTimeout } = {}) {
    const { spot } = await this.#reach(locator, 'click', timeout);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
  }

  /** Type value into a field in place of what it holds (a picker's field gets the value set), once it is on top. */
  async fill(locator, value, { timeout = this.actionTimeout } = {}) {
    const { objectId } = await this.#reach(locator, 'fill', timeout);
    const kind = await this.#call(objectId, function focusField() {
      this.scrollIntoView({ block: 'center', behavior: 'instant' });
      this.focus();
      return this.tagName === 'SELECT' ? 'select' : (this.getAttribute('type') ?? 'text').toLowerCase();
    });
    if (kind === 'select') throw new Error(`${describe(locator)} is a select: use choose()`);
    if (!SET_VALUE_TYPES.has(kind)) {
      await this.#call(objectId, function selectAll() { document.execCommand('selectAll'); });
      if (value === '') await this.press('Backspace');
      else await this.send('Input.insertText', { text: String(value) });
    }
    const typed = await this.#call(objectId, function current() { return this.isContentEditable ? this.textContent : this.value; });
    if (typed !== String(value)) await this.#setValue(objectId, String(value));
  }

  async #setValue(objectId, value) {
    await this.#call(objectId, function setValue(wanted) {
      const prototype = Object.getPrototypeOf(this);
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(this, wanted);
      else this.value = wanted;
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }

  /** Pick a select's option by its text, else by its value, once the select is on top. */
  async choose(locator, option, { timeout = this.actionTimeout } = {}) {
    const { objectId } = await this.#reach(locator, 'choose in', timeout);
    const value = await this.#call(objectId, function optionValue(wanted) {
      if (this.tagName !== 'SELECT') throw new Error('not a select');
      const fold = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();
      const options = [...this.options];
      const found = options.find((item) => fold(item.textContent) === fold(wanted))
        ?? options.find((item) => item.value === wanted)
        ?? options.find((item) => fold(item.textContent).includes(fold(wanted)));
      if (!found) throw new Error(`no option "${wanted}"; it has ${options.map((item) => item.textContent.trim()).join(', ')}`);
      return found.value;
    }, option);
    await this.#setValue(objectId, value);
  }

  /** Give a file input files from disk, as the file picker does. */
  async upload(locator, files, { timeout = this.actionTimeout } = {}) {
    const objectId = await this.locate({ ...locator, hidden: true }, { timeout });
    await this.send('DOM.setFileInputFiles', { objectId, files: [files].flat().map((file) => path.resolve(file)) });
  }

  /** Press a key (KEYS, or one printable character) on whatever has focus. */
  async press(key) {
    const spec = KEYS[key] ?? (key.length === 1 ? { key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), text: key } : null);
    if (!spec) throw new Error(`Unknown key ${key}`);
    const base = { key: spec.key ?? key, code: spec.code, windowsVirtualKeyCode: spec.keyCode, nativeVirtualKeyCode: spec.keyCode };
    await this.send('Input.dispatchKeyEvent', { type: spec.text ? 'keyDown' : 'rawKeyDown', ...base, ...(spec.text ? { text: spec.text, unmodifiedText: spec.text } : {}) });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  /** The focused element's role and accessible name, as a screen reader would announce it. */
  async focused() {
    return this.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      return { tag: element.tagName.toLowerCase(), name: (element.getAttribute('aria-label') ?? element.textContent ?? '').replace(/\s+/g, ' ').trim() };
    });
  }

  /** Fail when the page is wider than the viewport, naming what sticks out. */
  async expectNoHorizontalScroll() {
    const overflow = await this.evaluate(() => {
      const width = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= width + 1) return null;
      const wide = [...document.body.querySelectorAll('*')]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.right > width + 1;
        })
        .filter((element, _, all) => !all.some((other) => other !== element && other.contains(element)))
        .slice(0, 3)
        .map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${typeof element.className === 'string' && element.className ? `.${element.className.trim().split(/\s+/).slice(0, 4).join('.')}` : ''} (right edge ${Math.round(element.getBoundingClientRect().right)}px)`);
      return { scrollWidth: document.documentElement.scrollWidth, width, wide };
    });
    if (overflow) {
      throw new Error(`The page scrolls sideways: ${overflow.scrollWidth}px wide in a ${overflow.width}px viewport. Wider: ${overflow.wide.join('; ') || 'unknown'}`);
    }
  }

  /** The interactive elements and landmarks, for writing a journey. */
  async outline() {
    return this.evaluate(outlineInPage);
  }

  /** A PNG of the page, the whole page by default, up to maxHeight CSS pixels tall. */
  async screenshot(file, { fullPage = true, maxHeight = 8_000 } = {}) {
    const params = { format: 'png', captureBeyondViewport: fullPage };
    if (fullPage) {
      const { cssContentSize, cssLayoutViewport } = await this.send('Page.getLayoutMetrics');
      // As wide as the viewport: a page that is wider fails expectNoHorizontalScroll() instead.
      params.clip = {
        x: 0, y: 0, scale: 1, width: cssLayoutViewport.clientWidth,
        height: Math.max(cssLayoutViewport.clientHeight, Math.min(Math.ceil(cssContentSize.height), maxHeight)),
      };
    }
    const { data } = await this.send('Page.captureScreenshot', params);
    await writeFile(file, Buffer.from(data, 'base64'));
    return file;
  }

  /** The console errors and failed requests since the last call. */
  drain() {
    const drained = { consoleErrors: this.consoleErrors, failedRequests: this.failedRequests };
    this.consoleErrors = [];
    this.failedRequests = [];
    return drained;
  }

  async close() {
    this.#off?.();
    await this.cdp.send('Target.disposeBrowserContext', { browserContextId: this.browserContextId }).catch(() => {});
  }
}
