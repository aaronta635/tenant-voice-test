import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_CHANGED_EVENT, COUNTS_CHANGED_EVENT, COUNTS_POLL_MS, watchAccount, watchCounts } from './provider-refresh';

function fakePage(visibilityState: DocumentVisibilityState = 'visible') {
  return { window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState }) };
}

/** A load that stays in flight for 200 ms, like a request. */
function request() {
  return vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 200)));
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('workspace header counts', () => {
  it('polls every 30 seconds rather than every 10, and stops when asked', async () => {
    const page = fakePage();
    const messages = request();
    const others = request();
    const stop = watchCounts({ ...page, loadMessageCount: messages, loadOtherCounts: others });
    expect([messages.mock.calls.length, others.mock.calls.length]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect([messages.mock.calls.length, others.mock.calls.length]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(COUNTS_POLL_MS - 10_000);
    expect([messages.mock.calls.length, others.mock.calls.length]).toEqual([2, 2]);
    stop();
    await vi.advanceTimersByTimeAsync(COUNTS_POLL_MS * 4);
    expect([messages.mock.calls.length, others.mock.calls.length]).toEqual([2, 2]);
  });

  it('refreshes once when a returning tab fires both visibilitychange and focus', async () => {
    const page = fakePage();
    const messages = request();
    const others = request();
    const stop = watchCounts({ ...page, loadMessageCount: messages, loadOtherCounts: others });
    await vi.advanceTimersByTimeAsync(1_000);
    page.document.dispatchEvent(new Event('visibilitychange'));
    page.window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect([messages.mock.calls.length, others.mock.calls.length]).toEqual([2, 2]);
    stop();
  });

  it('waits while the tab is hidden', async () => {
    const page = fakePage('hidden');
    const messages = request();
    const others = request();
    const stop = watchCounts({ ...page, loadMessageCount: messages, loadOtherCounts: others });
    await vi.advanceTimersByTimeAsync(COUNTS_POLL_MS * 3);
    expect([messages.mock.calls.length, others.mock.calls.length]).toEqual([0, 0]);
    page.document.visibilityState = 'visible';
    page.document.dispatchEvent(new Event('visibilitychange'));
    expect([messages.mock.calls.length, others.mock.calls.length]).toEqual([1, 1]);
    stop();
  });

  it('loads the message count on every poll, and again straight after a read', async () => {
    const page = fakePage();
    const messages = request();
    const others = request();
    const stop = watchCounts({ ...page, loadMessageCount: messages, loadOtherCounts: others });
    await vi.advanceTimersByTimeAsync(COUNTS_POLL_MS * 2 + 1_000);
    expect([messages.mock.calls.length, others.mock.calls.length]).toEqual([3, 3]);
    page.window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT));
    expect(messages).toHaveBeenCalledTimes(4);
    stop();
  });

  it('runs once more when a count changes while a refresh is in flight', async () => {
    const page = fakePage();
    const messages = request();
    const others = request();
    const stop = watchCounts({ ...page, loadMessageCount: messages, loadOtherCounts: others });
    page.window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT));
    page.window.dispatchEvent(new Event(COUNTS_CHANGED_EVENT));
    await vi.advanceTimersByTimeAsync(1_000);
    expect([messages.mock.calls.length, others.mock.calls.length]).toEqual([2, 2]);
    stop();
  });
});

describe('workspace account', () => {
  it('loads the profile and provider once, then only after a save or a return to the tab', async () => {
    const page = fakePage();
    const load = request();
    const stop = watchAccount({ ...page, load });
    await vi.advanceTimersByTimeAsync(COUNTS_POLL_MS * 10);
    page.window.dispatchEvent(new Event('focus'));
    expect(load).toHaveBeenCalledTimes(1);
    page.window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    page.document.dispatchEvent(new Event('visibilitychange'));
    expect(load).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);
    stop();
    page.window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('tries again after a failed load', async () => {
    const page = fakePage();
    const load = vi.fn().mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(undefined);
    const stop = watchAccount({ ...page, load });
    await vi.advanceTimersByTimeAsync(0);
    page.window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });
});
