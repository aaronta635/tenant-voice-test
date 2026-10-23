/**
 * A minimal DOM so client components can be rendered by Vitest in its node
 * environment (the project has no jsdom). It covers only what React DOM and
 * the components under test use: a node tree, attributes, inline styles,
 * focus, <dialog> and bubbling events. Import it before anything that loads
 * react-dom; render() loads react-dom/client once the globals exist.
 */
import { act, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';

const HTML_NS = 'http://www.w3.org/1999/xhtml';

type ListenerOptions = boolean | { capture?: boolean };
type Listener = { callback: EventListenerOrEventListenerObject; capture: boolean };

function isCapture(options?: ListenerOptions) {
  return typeof options === 'boolean' ? options : !!options?.capture;
}

/** Event dispatched by tests; dispatchEvent sets its target. */
export class FakeEvent {
  target: FakeEventTarget | null = null;
  currentTarget: FakeEventTarget | null = null;
  defaultPrevented = false;
  propagationStopped = false;
  readonly timeStamp = Date.now();
  readonly isTrusted = false;
  readonly cancelable = true;
  readonly bubbles: boolean;
  constructor(readonly type: string, init: Record<string, unknown> = {}) {
    this.bubbles = init.bubbles !== false;
    Object.assign(this, init);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
  stopImmediatePropagation() { this.propagationStopped = true; }
}

export class FakeEventTarget {
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: ListenerOptions) {
    if (!callback) return;
    const capture = isCapture(options);
    const list = this.listeners.get(type) ?? [];
    if (!list.some((item) => item.callback === callback && item.capture === capture)) list.push({ callback, capture });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: ListenerOptions) {
    const capture = isCapture(options);
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item.callback !== callback || item.capture !== capture));
  }

  protected eventParent(): FakeEventTarget | null { return null; }

  private invoke(event: Event | FakeEvent, capture: boolean) {
    if (event instanceof FakeEvent) event.currentTarget = this;
    for (const { callback, capture: listenerCapture } of [...(this.listeners.get(event.type) ?? [])]) {
      if (listenerCapture !== capture) continue;
      if (typeof callback === 'function') callback.call(this, event as Event);
      else callback.handleEvent(event as Event);
    }
  }

  /** Captures down from the window and bubbles back up, like the browser. */
  dispatchEvent(event: Event | FakeEvent): boolean {
    if (!(event instanceof FakeEvent)) {
      this.invoke(event, true);
      this.invoke(event, false);
      return !event.defaultPrevented;
    }
    event.target = this;
    const path: FakeEventTarget[] = [this];
    for (let node = this.eventParent(); node; node = node.eventParent()) path.push(node);
    for (let index = path.length - 1; index > 0 && !event.propagationStopped; index -= 1) path[index].invoke(event, true);
    if (!event.propagationStopped) path[0].invoke(event, true);
    if (!event.propagationStopped) path[0].invoke(event, false);
    for (let index = 1; index < path.length && event.bubbles && !event.propagationStopped; index += 1) path[index].invoke(event, false);
    return !event.defaultPrevented;
  }
}

export class FakeNode extends FakeEventTarget {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  constructor(readonly ownerDocument: FakeDocument | null, readonly nodeType: number, readonly nodeName: string) { super(); }

  protected eventParent(): FakeEventTarget | null { return this.parentNode; }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): FakeNode | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get previousSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) - 1] ?? null;
  }
  get parentElement(): FakeElement | null { return this.parentNode instanceof FakeElement ? this.parentNode : null; }
  get isConnected(): boolean { return this.parentNode ? this.parentNode.isConnected : this instanceof FakeDocument; }
  get textContent(): string { return this.childNodes.map((child) => child.textContent).join(''); }
  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value && this.ownerDocument) this.appendChild(this.ownerDocument.createTextNode(value));
  }
  appendChild<T extends FakeNode>(child: T): T { return this.insertBefore(child, null); }
  insertBefore<T extends FakeNode>(child: T, reference: FakeNode | null): T {
    child.parentNode?.removeChild(child);
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index === -1) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild<T extends FakeNode>(child: T): T {
    this.childNodes = this.childNodes.filter((node) => node !== child);
    child.parentNode = null;
    return child;
  }
  contains(node: FakeNode | null) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
}

export class FakeText extends FakeNode {
  constructor(ownerDocument: FakeDocument, public data: string) { super(ownerDocument, 3, '#text'); }
  get nodeValue() { return this.data; }
  set nodeValue(value: string) { this.data = value; }
  get textContent() { return this.data; }
  set textContent(value: string) { this.data = value; }
}

function createStyle() {
  const properties = new Map<string, string>();
  return Object.assign(Object.create(null) as Record<string, unknown>, {
    setProperty(name: string, value: string) { properties.set(name, value); },
    removeProperty(name: string) { properties.delete(name); },
    getPropertyValue(name: string) { return properties.get(name) ?? ''; },
  });
}

export class FakeElement extends FakeNode {
  readonly tagName: string;
  readonly style = createStyle();
  readonly attributes = new Map<string, string>();
  selectionStart = 0;
  selectionEnd = 0;
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight = 0;
  clientHeight = 0;
  inert = false;
  type = '';
  value = '';
  checked = false;
  selected = false;
  files: File[] | null = null;

  constructor(ownerDocument: FakeDocument, readonly localName: string, readonly namespaceURI: string) {
    super(ownerDocument, 1, namespaceURI === HTML_NS ? localName.toUpperCase() : localName);
    this.tagName = this.nodeName;
    if (this.tagName === 'INPUT') this.type = 'text';
    if (this.tagName === 'OPTION') {
      Object.defineProperty(this, 'value', {
        get: () => this.getAttribute('value') ?? this.textContent,
        set: (value: string) => this.setAttribute('value', value),
      });
    }
    if (this.tagName === 'SELECT') {
      Object.defineProperty(this, 'value', {
        get: () => (this.options.find((option) => option.selected) ?? this.options[0])?.value ?? '',
        set: (value: string) => { for (const option of this.options) option.selected = option.value === value; },
      });
    }
    if (this.tagName === 'DIALOG') {
      Object.defineProperty(this, 'open', {
        get: () => this.hasAttribute('open'),
        set: (value: boolean) => { if (value) this.setAttribute('open', ''); else this.removeAttribute('open'); },
      });
    }
  }

  get children(): FakeElement[] { return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement); }
  get options(): FakeElement[] { return descendants(this).filter((node) => node.tagName === 'OPTION'); }
  get className() { return this.getAttribute('class') ?? ''; }
  get id() { return this.getAttribute('id') ?? ''; }
  setAttribute(name: string, value: unknown) { this.attributes.set(name, String(value)); }
  setAttributeNS(_namespace: string | null, name: string, value: unknown) { this.setAttribute(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  removeAttributeNS(_namespace: string | null, name: string) { this.removeAttribute(name); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
  scrollIntoView() {}
  showModal() { this.setAttribute('open', ''); }
  close() { this.removeAttribute('open'); }
  querySelectorAll(selectors: string) { return descendants(this).filter((element) => matchesSelector(element, selectors)); }
}

/** The selectors components pass to querySelectorAll: tag, [attr] and :not([attr]), comma-separated. */
function matchesSelector(element: FakeElement, selectors: string) {
  return selectors.split(',').some((selector) => {
    const match = /^\s*([a-z0-9]*)((?:\[[\w-]+\])*)((?::not\(\[[\w-]+\]\))*)\s*$/i.exec(selector);
    if (!match) throw new Error(`The test DOM does not support the selector "${selector}"`);
    const [, tag, required, excluded] = match;
    const names = (part: string) => [...part.matchAll(/\[([\w-]+)\]/g)].map((name) => name[1]);
    return (!tag || element.localName === tag.toLowerCase())
      && names(required).every((name) => element.hasAttribute(name))
      && names(excluded).every((name) => !element.hasAttribute(name));
  });
}

export class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly head: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement | null;
  visibilityState: DocumentVisibilityState = 'visible';
  cookie = '';
  oninput = null;

  constructor(readonly defaultView: FakeWindow) {
    super(null, 9, '#document');
    this.documentElement = this.appendChild(this.createElement('html'));
    this.head = this.documentElement.appendChild(this.createElement('head'));
    this.body = this.documentElement.appendChild(this.createElement('body'));
    this.activeElement = this.body;
  }

  protected eventParent(): FakeEventTarget | null { return this.defaultView; }
  createElement(tag: string) { return new FakeElement(this, tag.toLowerCase(), HTML_NS); }
  createElementNS(namespace: string | null, tag: string) { return new FakeElement(this, tag, namespace ?? HTML_NS); }
  createTextNode(text: string) { return new FakeText(this, text); }
  getElementById(id: string) { return descendants(this).find((node) => node.id === id) ?? null; }
}

class FakeIFrameElement {}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
}

export class FakeWindow extends FakeEventTarget {
  readonly document: FakeDocument;
  readonly HTMLIFrameElement = FakeIFrameElement;
  readonly ResizeObserver = FakeResizeObserver;
  readonly innerHeight = 800;
  readonly innerWidth = 1280;
  readonly localStorage = createStorage();
  readonly setTimeout = globalThis.setTimeout.bind(globalThis);
  readonly clearTimeout = globalThis.clearTimeout.bind(globalThis);
  readonly setInterval = globalThis.setInterval.bind(globalThis);
  readonly clearInterval = globalThis.clearInterval.bind(globalThis);
  event: Event | undefined = undefined;
  visualViewport = undefined;
  constructor() {
    super();
    this.document = new FakeDocument(this);
  }
  requestAnimationFrame(callback: (time: number) => void) { return Number(globalThis.setTimeout(() => callback(Date.now()), 0)); }
  cancelAnimationFrame(handle: number) { globalThis.clearTimeout(handle); }
  scrollTo() {}
}

const fakeWindow = new FakeWindow();
for (const [key, value] of Object.entries({
  window: fakeWindow,
  document: fakeWindow.document,
  HTMLElement: FakeElement,
  HTMLIFrameElement: FakeIFrameElement,
  ResizeObserver: FakeResizeObserver,
  localStorage: fakeWindow.localStorage,
  requestAnimationFrame: fakeWindow.requestAnimationFrame.bind(fakeWindow),
  cancelAnimationFrame: fakeWindow.cancelAnimationFrame.bind(fakeWindow),
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

/** Every element below `root`, in document order. */
export function descendants(root: FakeNode): FakeElement[] {
  return root.childNodes.flatMap((node) => (node instanceof FakeElement ? [node, ...descendants(node)] : []));
}

/** Text content with whitespace collapsed, as a reader would see it. */
export function textOf(node: FakeNode) {
  return node.textContent.replace(/\s+/g, ' ').trim();
}

/** Accessible name for the controls these tests look up: aria-label, else text. */
export function nameOf(element: FakeElement) {
  return element.getAttribute('aria-label') ?? textOf(element);
}

/** The radius, border, shadow and background utilities that give a surface its look, sorted. */
export function surfaceStyle(element: FakeElement) {
  return element.className.split(/\s+/).filter((utility) => /^(rounded|border|shadow|bg-)/.test(utility)).sort();
}

/** The single element with this tag and accessible name; fails loudly otherwise. */
export function getByName(root: FakeNode, tag: string, name: string | RegExp) {
  const candidates = descendants(root).filter((element) => element.tagName === tag.toUpperCase());
  const matches = candidates.filter((element) => (typeof name === 'string' ? nameOf(element) === name : name.test(nameOf(element))));
  if (matches.length !== 1) {
    throw new Error(`Expected one <${tag}> named ${String(name)}, found ${matches.length} among: ${candidates.map(nameOf).join(' | ')}`);
  }
  return matches[0];
}

export function fire(target: FakeEventTarget, type: string, init: Record<string, unknown> = {}) {
  return target.dispatchEvent(new FakeEvent(type, init));
}

const roots: Root[] = [];

/** Lets pending promises and zero-delay timers settle inside act(). */
export async function settle(rounds = 3) {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

export async function render(ui: ReactNode) {
  const { createRoot } = await import('react-dom/client');
  const container = fakeWindow.document.body.appendChild(fakeWindow.document.createElement('div'));
  const root = createRoot(container as unknown as HTMLElement);
  roots.push(root);
  await act(async () => { root.render(ui); });
  await settle();
  return container;
}

export async function cleanup() {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  for (const child of fakeWindow.document.body.childNodes) fakeWindow.document.body.removeChild(child);
}

/** Fires an event inside act() and lets the work it starts settle. */
export async function dispatch(target: FakeEventTarget | EventTarget, type: string) {
  await act(async () => {
    if (target instanceof FakeEventTarget) fire(target, type);
    else target.dispatchEvent(new Event(type));
  });
  await settle();
}

export function click(element: FakeElement) {
  return dispatch(element, 'click');
}

/** Types a whole value into a text field, as one input event. */
export async function typeInto(element: FakeElement, value: string) {
  element.value = value;
  await act(async () => { fire(element, 'input'); });
}
