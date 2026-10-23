import { vi } from 'vitest';

/** Just enough of an HTML element for code that builds DOM nodes by hand. */
export type FakeElement = {
  tagName: string;
  className: string;
  textContent: string;
  href: string;
  attributes: Record<string, string>;
  children: FakeElement[];
  focus: () => void;
  setAttribute: (name: string, value: string) => void;
  append: (...nodes: FakeElement[]) => void;
};

function createElement(tagName: string): FakeElement {
  const element: FakeElement = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    href: '',
    attributes: {},
    children: [],
    focus: vi.fn(),
    setAttribute: (name, value) => { element.attributes[name] = value; },
    append: (...nodes) => { element.children.push(...nodes); },
  };
  return element;
}

/** Test-only browser globals for session code: a cookie jar, localStorage, window events and a body. */
export function stubBrowser({ protocol = 'https:', pathname = '/', search = '' } = {}) {
  const cookies = new Map<string, string>();
  const storage = new Map<string, string>();
  const cookieWrites: string[] = [];
  const replace = vi.fn();
  const window = Object.assign(new EventTarget(), { location: { protocol, pathname, search, replace } });
  vi.stubGlobal('window', window);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  const body = { style: { visibility: '' }, children: [] as FakeElement[], append: (...nodes: FakeElement[]) => { body.children.push(...nodes); } };
  vi.stubGlobal('document', {
    body,
    createElement,
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
    set cookie(value: string) {
      cookieWrites.push(value);
      const [pair] = value.split(';');
      const separator = pair.indexOf('=');
      const key = pair.slice(0, separator);
      if (/max-age=0(?:;|$)/.test(value)) cookies.delete(key); else cookies.set(key, pair.slice(separator + 1));
    },
  });
  return { cookies, storage, cookieWrites, window, replace, body };
}

/** An unsigned JWT whose exp claim lies `seconds` from now (negative for the past). */
export function jwtExpiringIn(seconds: number): string {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ exp: Math.floor(Date.now() / 1000) + seconds })}.signature`;
}
