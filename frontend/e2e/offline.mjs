// Loaded into the E2E run's `next dev` (NODE_OPTIONS=--import, see run.mjs):
// the frontend may reach this machine only, so a journey never calls a real
// service. Next's own calls out (the version check of the dev overlay) fail
// as when offline, which Next already handles. Google Fonts are not fetched
// either: run.mjs hands Next mocked font responses
// (NEXT_FONT_GOOGLE_MOCKED_RESPONSES).
import net from 'node:net';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function isLocal(host) {
  if (host === undefined || host === null) return true;
  const name = String(host).toLowerCase();
  return LOCAL_HOSTS.has(name) || name.startsWith('127.');
}

function hostOf(args) {
  const [first, second] = args;
  if (first && typeof first === 'object') return first.path ? 'localhost' : first.host ?? first.hostname;
  if (typeof first === 'number' || /^\d+$/.test(String(first))) return typeof second === 'string' ? second : undefined;
  return 'localhost'; // a unix socket path
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const host = hostOf(Array.isArray(args[0]) ? args[0] : args);
  if (!isLocal(host)) {
    const error = Object.assign(new Error(`E2E: no connections outside this machine (${host})`), { code: 'ECONNREFUSED' });
    process.nextTick(() => this.destroy(error));
    return this;
  }
  return connect.apply(this, args);
};

const fetch = globalThis.fetch;
if (fetch) {
  globalThis.fetch = function guardedFetch(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!isLocal(url.hostname)) {
      return Promise.reject(new TypeError(`E2E: no requests outside this machine (${url.hostname})`));
    }
    return fetch.call(this, input, init);
  };
}
