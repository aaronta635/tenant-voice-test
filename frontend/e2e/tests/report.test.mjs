// What fails a journey, and what the report says (e2e/report.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, journeyFailed, renderReport, runJourney, slug } from '../report.mjs';

const passed = (overrides = {}) => ({
  journey: 'tenant', title: 'Tenant', viewport: 'phone', size: '390x844', ms: 4200,
  steps: [{ name: 'Sign in', status: 'passed', ms: 900, screenshot: 'screenshots/tenant-phone-01-sign-in.png' }],
  consoleErrors: [], failedRequests: [], clientErrors: [], expected: [], ...overrides,
});

describe('classify', () => {
  it('fails on console errors, network failures and 5xx, and only lists other 4xx answers', () => {
    const sorted = classify({
      consoleErrors: [{ kind: 'console.error', text: 'Each child in a list should have a unique key' }],
      failedRequests: [
        { method: 'GET', url: 'http://127.0.0.1:1/api/v1/me', status: null, error: 'net::ERR_CONNECTION_REFUSED' },
        { method: 'GET', url: 'http://127.0.0.1:1/api/v1/bookings', status: 500 },
        { method: 'GET', url: 'http://127.0.0.1:1/api/v1/me/provider', status: 404 },
      ],
    });

    assert.equal(sorted.consoleErrors.length, 1);
    assert.deepEqual(sorted.failedRequests.map((request) => request.status), [null, 500]);
    assert.deepEqual(sorted.clientErrors.map((request) => request.status), [404]);
    assert.equal(sorted.expected.length, 0);
  });

  it('keeps what a journey expects apart, with its reason', () => {
    const sorted = classify({
      consoleErrors: [{ kind: 'console.error', text: 'Known noise' }],
      failedRequests: [
        { method: 'POST', url: 'http://127.0.0.1:1/api/v1/me/properties', status: 403 },
        { method: 'POST', url: 'http://127.0.0.1:1/api/v1/me/properties', status: 500 },
      ],
    }, {
      requests: [{ url: '/api/v1/me/properties', status: 403, why: 'the gate refuses' }],
      console: [{ text: /Known/, why: 'logged by design' }],
    });

    assert.deepEqual(sorted.expected.map((item) => item.why), ['logged by design', 'the gate refuses']);
    assert.deepEqual(sorted.failedRequests.map((request) => request.status), [500]);
    assert.equal(sorted.consoleErrors.length, 0);
  });
});

describe('journeyFailed', () => {
  it('fails a journey for a failed step, a console error or a failed request', () => {
    assert.equal(journeyFailed(passed()), false);
    assert.equal(journeyFailed(passed({ steps: [{ name: 'Sign in', status: 'failed', error: 'x' }] })), true);
    assert.equal(journeyFailed(passed({ consoleErrors: [{ kind: 'exception', text: 'TypeError' }] })), true);
    assert.equal(journeyFailed(passed({ failedRequests: [{ method: 'GET', url: '/x', status: 502 }] })), true);
    assert.equal(journeyFailed(passed({ clientErrors: [{ method: 'GET', url: '/x', status: 404 }] })), false);
  });
});

describe('renderReport', () => {
  it('has a row per journey and size, then every step with its screenshot, errors and requests', () => {
    const failing = passed({
      viewport: 'desktop', size: '1440x900',
      steps: [
        { name: 'Sign in', status: 'passed', ms: 800, screenshot: 'screenshots/a.png' },
        { name: 'Save | preferences', status: 'failed', ms: 20_000, error: 'Timed out waiting for button "Save"', screenshot: 'screenshots/b.png' },
        { name: 'Apply', status: 'skipped' },
      ],
      consoleErrors: [{ step: 'Sign in', kind: 'console.error', text: 'Duplicate key', url: 'http://127.0.0.1:1/chunk.js' }],
      failedRequests: [{ step: 'Sign in', method: 'GET', url: 'http://127.0.0.1:1/api/v1/x', status: 500 }],
    });

    const report = renderReport([passed(), failing], { commit: 'abc1234', api: 'http://127.0.0.1:1', web: 'http://127.0.0.1:2', now: new Date('2026-10-23T00:00:00Z') });

    assert.match(report, /Commit `abc1234` · 2026-10-23T00:00:00.000Z · 1 of 2 journey runs passed\./);
    assert.match(report, /\| Tenant \| PASS \(1 steps, 4\.2 s\) \| FAIL at step 2 of 3 \|/);
    assert.match(report, /\| 2 \| Save \\\| preferences \| FAIL: Timed out waiting for button "Save" \| 20\.0 s \| \[screenshot\]\(screenshots\/b\.png\) \|/);
    assert.match(report, /\| 3 \| Apply \| skipped \|/);
    assert.match(report, /\*\*Console errors \(1\)\*\*\n\n- "Sign in": console\.error: Duplicate key \(http:\/\/127\.0\.0\.1:1\/chunk\.js\)/);
    assert.match(report, /- "Sign in": GET http:\/\/127\.0\.0\.1:1\/api\/v1\/x → 500/);
    assert.match(report, /The shared database is not covered/);
  });
});

/** A page as runJourney uses one, whose width is too wide once wide() says so. */
function fakePage(wide) {
  const page = {
    step: null, checkScroll: false, dialogs: [], screenshots: [],
    setViewport: async () => {},
    screenshot: async (file) => { page.screenshots.push(file); },
    drain: () => ({ consoleErrors: [], failedRequests: [] }),
    close: async () => {},
    expectNoHorizontalScroll: async () => {
      if (wide()) throw new Error('The page scrolls sideways: 452px wide in a 390px viewport');
    },
  };
  return page;
}

describe('runJourney', () => {
  it('checks every page a journey opens, and fails a step that ends on a page scrolling sideways', async () => {
    let wide = false;
    const page = fakePage(() => wide);
    const journey = {
      name: 'tenant', title: 'Tenant',
      async run({ step }) {
        await step('A page that fits', async () => {});
        await step('A page that does not', async () => { wide = true; });
        await step('Never run', async () => {});
      },
    };

    const result = await runJourney(journey, {
      browser: { newPage: async () => page }, viewport: { name: 'phone', width: 390, height: 844 }, fixtures: {},
      api: '', web: '', out: 'unused',
    });

    assert.equal(page.checkScroll, true);
    assert.deepEqual(result.steps.map((item) => item.status), ['passed', 'failed', 'skipped']);
    assert.match(result.steps[1].error, /scrolls sideways/);
  });
});

describe('slug', () => {
  it('names a screenshot after its step', () => {
    assert.equal(slug('Apply with the form the profile fills!'), 'apply-with-the-form-the-profile-fills');
  });
});
