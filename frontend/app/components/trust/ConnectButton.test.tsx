import { cleanup, click, descendants, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { hovered, lowContrastText } from '@/app/components/ui/test-contrast';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/app/lib/api';
import type { ConnectionState, ConnectionStateName } from '@/app/lib/connections';
import { COUNTS_CHANGED_EVENT } from '@/app/lib/provider-refresh';
import ConnectButton from './ConnectButton';

const mocks = vi.hoisted(() => ({ state: vi.fn(), request: vi.fn(), respond: vi.fn(), remove: vi.fn() }));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: { connections: { request: mocks.request, respond: mocks.respond, remove: mocks.remove } },
}));
vi.mock('@/app/lib/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/connections')>()),
  getConnectionState: mocks.state,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

const MEI = 'c0000000-0000-4000-8000-000000000041';
const REQUEST = 'e0000000-0000-4000-8000-000000000041';
const PATH = `/public/${MEI}`;

function state(name: ConnectionStateName, connection_id: string | null = REQUEST): ConnectionState {
  return { user_id: MEI, state: name, connection_id: name === 'none' ? null : connection_id };
}

function connectButton(props: Partial<Parameters<typeof ConnectButton>[0]> = {}) {
  return render(<div className="bg-white"><ConnectButton userId={MEI} name="Mei Lin" signedIn returnTo={PATH} {...props} /></div>);
}

const buttons = (view: FakeElement) => descendants(view).filter((element) => element.tagName === 'BUTTON').map(textOf);

let counts: number;
const countChanged = () => { counts += 1; };

beforeEach(() => {
  vi.clearAllMocks();
  counts = 0;
  window.addEventListener(COUNTS_CHANGED_EVENT, countChanged);
  mocks.request.mockResolvedValue({ id: REQUEST });
  mocks.respond.mockResolvedValue({ id: REQUEST });
  mocks.remove.mockResolvedValue(undefined);
});
afterEach(async () => {
  window.removeEventListener(COUNTS_CHANGED_EVENT, countChanged);
  await cleanup();
});

describe('ConnectButton signed out', () => {
  it('asks the visitor to sign in and come back to the profile', async () => {
    const view = await connectButton({ signedIn: false });

    expect(getByName(view, 'a', 'Sign in to connect').getAttribute('href')).toBe(`/login?next=${encodeURIComponent(PATH)}`);
    expect(mocks.state).not.toHaveBeenCalled();
  });
});

describe('ConnectButton states', () => {
  it('says it is checking until the state arrives, then offers Connect', async () => {
    let answer: (value: ConnectionState) => void = () => {};
    mocks.state.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const view = await connectButton();
    expect(textOf(view)).toBe('Checking your connection…');

    await act(async () => answer(state('none')));
    await settle();
    expect(mocks.state).toHaveBeenCalledWith(MEI);
    expect(buttons(view)).toEqual(['Connect']);
  });

  it.each(['self', 'unavailable'] as const)('shows nothing for %s', async (name) => {
    mocks.state.mockResolvedValue(state(name, null));
    const view = await connectButton();

    expect(textOf(view)).toBe('');
  });

  it('shows a request sent as pending, with Withdraw', async () => {
    mocks.state.mockResolvedValue(state('sent'));
    const view = await connectButton();

    expect(textOf(view)).toContain('Pending: request sent');
    expect(getByName(view, 'button', 'Withdraw your request to Mei Lin')).toBeTruthy();
  });

  it('offers Accept and Decline for a request they sent', async () => {
    mocks.state.mockResolvedValue(state('received'));
    const view = await connectButton();

    expect(textOf(view)).toContain('Mei Lin wants to connect');
    expect(getByName(view, 'button', "Accept Mei Lin's request")).toBeTruthy();
    expect(getByName(view, 'button', "Decline Mei Lin's request")).toBeTruthy();
  });

  it('shows a connection, with what the page offers beside it', async () => {
    mocks.state.mockResolvedValue(state('connected'));
    const view = await connectButton({ connectedAction: <button type="button">Message</button> });

    expect(textOf(view)).toContain('Connected');
    expect(buttons(view)).toEqual(['Message']);
  });

  it('offers nothing to someone whose request was declined', async () => {
    mocks.state.mockResolvedValue(state('declined'));
    const view = await connectButton();

    expect(textOf(view)).toContain('Mei Lin declined your request.');
    expect(buttons(view)).toEqual([]);
  });

  it('uses the state a list already has instead of reading it', async () => {
    const view = await connectButton({ initialState: state('received') });

    expect(mocks.state).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Mei Lin wants to connect');
  });

  it('says when the state cannot be read, and tries again', async () => {
    mocks.state.mockRejectedValueOnce(new ApiError(503, 'The service is temporarily unavailable.'));
    mocks.state.mockResolvedValueOnce(state('none'));
    const view = await connectButton();
    expect(textOf(view)).toContain('Could not check your connection with Mei Lin.');

    await click(getByName(view, 'button', 'Try again'));

    expect(mocks.state).toHaveBeenCalledTimes(2);
    expect(buttons(view)).toEqual(['Connect']);
  });
});

describe('ConnectButton actions', () => {
  it('sends a request and shows it pending', async () => {
    mocks.state.mockResolvedValue(state('none'));
    const shown: string[] = [];
    const view = await connectButton({ onState: (name) => shown.push(name) });

    await click(getByName(view, 'button', 'Connect with Mei Lin'));

    expect(mocks.request).toHaveBeenCalledWith(MEI);
    expect(textOf(view)).toContain('Pending: request sent');
    expect(textOf(view)).toContain('Request sent to Mei Lin.');
    expect(counts).toBe(1);
    expect(shown).toEqual(['none', 'sent']);  // what a frame around the button follows
    // The pressed button is gone, so focus moves to what happened.
    expect(textOf(document.activeElement as unknown as FakeElement)).toContain('Request sent to Mei Lin.');
  });

  it('withdraws a sent request, and can send another', async () => {
    mocks.state.mockResolvedValue(state('sent'));
    const view = await connectButton();

    await click(getByName(view, 'button', 'Withdraw your request to Mei Lin'));

    expect(mocks.remove).toHaveBeenCalledWith(REQUEST);
    expect(textOf(view)).toContain('Request withdrawn.');
    expect(buttons(view)).toEqual(['Connect']);
  });

  it('accepts a request', async () => {
    mocks.state.mockResolvedValue(state('received'));
    const view = await connectButton();

    await click(getByName(view, 'button', "Accept Mei Lin's request"));

    expect(mocks.respond).toHaveBeenCalledWith(REQUEST, 'accepted');
    expect(textOf(view)).toContain('You and Mei Lin are now connected.');
    expect(textOf(view)).toContain('Connected');
  });

  it('asks before declining, and leaves the person who declined free to ask', async () => {
    mocks.state.mockResolvedValue(state('received'));
    const view = await connectButton();

    await click(getByName(view, 'button', "Decline Mei Lin's request"));
    expect(textOf(view)).toContain("Decline Mei Lin's request? After that, only you can send a new one.");
    // The pressed button is gone: focus moves to the question, and back to Decline after Keep.
    expect(textOf(document.activeElement as unknown as FakeElement)).toBe("Decline Mei Lin's request? After that, only you can send a new one.");
    await click(getByName(view, 'button', 'Keep request'));
    expect(mocks.respond).not.toHaveBeenCalled();
    expect(textOf(view)).toContain('Mei Lin wants to connect');
    expect(document.activeElement).toBe(getByName(view, 'button', "Decline Mei Lin's request"));

    await click(getByName(view, 'button', "Decline Mei Lin's request"));
    await click(getByName(view, 'button', 'Decline request'));

    expect(mocks.respond).toHaveBeenCalledWith(REQUEST, 'declined');
    expect(textOf(view)).toContain('Request declined. You can still send Mei Lin a request later.');
    expect(buttons(view)).toEqual(['Connect']);
  });

  it('shows what changed when the request was answered elsewhere meanwhile', async () => {
    mocks.state.mockResolvedValueOnce(state('none')).mockResolvedValueOnce(state('received'));
    mocks.request.mockRejectedValue(new ApiError(409, 'A connection already exists with this member'));
    const view = await connectButton();

    await click(getByName(view, 'button', 'Connect with Mei Lin'));

    expect(textOf(view)).toContain('A connection already exists with this member');
    expect(textOf(view)).toContain('Mei Lin wants to connect');
    expect(counts).toBe(0);
  });

  it('keeps the button when a request fails for another reason', async () => {
    mocks.state.mockResolvedValue(state('none'));
    mocks.request.mockRejectedValue(new TypeError('Failed to fetch'));
    const view = await connectButton();

    await click(getByName(view, 'button', 'Connect with Mei Lin'));

    expect(textOf(view)).toContain('Could not send your request. Please try again.');
    expect(buttons(view)).toEqual(['Connect']);
    expect(mocks.state).toHaveBeenCalledTimes(1);
  });
});

describe('ConnectButton contrast', () => {
  it.each(['none', 'sent', 'received', 'connected', 'declined'] as const)('keeps the %s state at AA contrast, also under the pointer', async (name) => {
    const view = await connectButton({ initialState: state(name) });

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });

  it('keeps the sign-in link at AA contrast', async () => {
    const view = await connectButton({ signedIn: false });

    expect(lowContrastText(view)).toEqual([]);
    expect(lowContrastText(hovered(view))).toEqual([]);
  });
});
