import { cleanup, click, descendants, getByName, render, settle, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerificationDocument } from '@/app/lib/api';
import VerificationDocuments from './VerificationDocuments';

const mockApi = vi.hoisted(() => ({
  providers: { mine: vi.fn(), addDocument: vi.fn(), updateDocument: vi.fn(), deleteDocument: vi.fn() },
  uploads: { verificationDocument: vi.fn() },
}));
vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  api: mockApi,
}));

type Named = { visible: string; name: string };

function buttons(documents: VerificationDocument[]): Named[] {
  const html = renderToStaticMarkup(<VerificationDocuments documents={documents} onChange={() => undefined} />);
  const text = (markup: string) => markup.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, body]) => ({
    visible: text(body.replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '')),
    name: /aria-label="([^"]*)"/.exec(attributes)?.[1] ?? text(body),
  }));
}

const abnWithoutFile = {
  id: 'abn', type: 'abn', label: 'ABN registration', status: 'pending', document_url: null, created_at: '2026-10-01T00:00:00Z',
} as VerificationDocument;
const verifiedInsurance = {
  id: 'insurance', type: 'insurance', label: 'Insurance', status: 'verified', document_url: null, created_at: '2026-10-01T00:00:00Z',
} as VerificationDocument;

describe('credential buttons', () => {
  it('keep their visible words in the name a screen reader or voice control uses', () => {
    for (const button of buttons([abnWithoutFile])) expect(button.name).toContain(button.visible);
  });

  it('name the button by what it shows plus the credential', () => {
    const names = buttons([abnWithoutFile]).map((button) => button.name);
    expect(names).toContain('Attach file for ABN registration');
    expect(names).toContain('Remove ABN registration');
    expect(names).toContain('Upload file for Government ID');
    expect(names).not.toContain('Replace file for ABN registration');
  });
});

function Credentials({ initial }: { initial: VerificationDocument[] }) {
  const [documents, setDocuments] = useState(initial);
  return <VerificationDocuments documents={documents} onChange={setDocuments} />;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const focused = () => document.activeElement as unknown as FakeElement;

describe('credential focus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.providers.mine.mockResolvedValue({ id: 'provider-1' });
  });
  afterEach(cleanup);

  it('keeps focus on the pressed button while it saves, then moves it to the row result', async () => {
    const saved = deferred<VerificationDocument>();
    mockApi.providers.addDocument.mockReturnValue(saved.promise);
    const view = await render(<Credentials initial={[]} />);
    const submit = getByName(view, 'button', 'Submit ABN');
    submit.focus();
    await click(submit);

    // A disabled button loses focus, which drops keyboard users to the page.
    expect(submit.hasAttribute('disabled')).toBe(false);
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(focused()).toBe(submit);

    await act(async () => saved.resolve(abnWithoutFile));
    await settle();
    expect(focused().id).toBe('credential-feedback-abn');
    expect(focused().getAttribute('tabindex')).toBe('-1');
    expect(textOf(focused())).toBe('ABN registration submitted for review.');
  });

  it('leaves focus in the field the provider moved to while the credential saved', async () => {
    const saved = deferred<VerificationDocument>();
    mockApi.providers.addDocument.mockReturnValue(saved.promise);
    // The profile page has its own form above the credentials.
    const view = await render(<><input aria-label="Business name" /><Credentials initial={[]} /></>);
    const submit = getByName(view, 'button', 'Submit ABN');
    submit.focus();
    await click(submit);
    const field = getByName(view, 'input', 'Business name');
    field.focus();

    await act(async () => saved.resolve(abnWithoutFile));
    await settle();
    expect(focused()).toBe(field);
    expect(textOf(view)).toContain('ABN registration submitted for review.');
  });

  it('returns from the confirmation to Remove, then to the row once the credential is gone', async () => {
    const removed = deferred<void>();
    mockApi.providers.deleteDocument.mockReturnValue(removed.promise);
    const view = await render(<Credentials initial={[abnWithoutFile]} />);
    const remove = getByName(view, 'button', 'Remove ABN registration');
    remove.focus();
    await click(remove);
    const confirm = getByName(view, 'button', 'Remove credential');
    confirm.focus();
    await click(confirm);

    expect(view.querySelectorAll('dialog')[0].hasAttribute('open')).toBe(false);
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(focused()).toBe(remove);

    await act(async () => removed.resolve());
    await settle();
    expect(focused().id).toBe('credential-feedback-abn');
    expect(textOf(focused())).toBe('ABN registration removed.');
  });

  it('ignores presses on other credentials while one saves', async () => {
    mockApi.providers.addDocument.mockReturnValue(deferred<VerificationDocument>().promise);
    const view = await render(<Credentials initial={[verifiedInsurance]} />);
    await click(getByName(view, 'button', 'Submit ABN'));
    await click(getByName(view, 'button', 'Remove Insurance'));

    expect(view.querySelectorAll('dialog')[0].hasAttribute('open')).toBe(false);
    expect(mockApi.providers.addDocument).toHaveBeenCalledTimes(1);
  });
});

describe('a rejected credential', () => {
  const rejectedInsurance = {
    id: 'insurance', type: 'insurance', label: 'Insurance', status: 'rejected', rejection_reason: 'The policy has expired.',
    document_url: 'https://storage.example.test/signed/Insurance.pdf', created_at: '2026-10-01T00:00:00Z',
  } as VerificationDocument;

  const byId = (view: FakeElement, id: string) => descendants(view).find((element) => element.id === id);

  afterEach(cleanup);

  it('says why it was rejected, beside the Replace that sends a new file for review', async () => {
    const view = await render(<Credentials initial={[rejectedInsurance]} />);
    const reason = byId(view, 'credential-rejection-insurance')!;

    expect(textOf(reason)).toBe('Rejected: The policy has expired. Replace the file to send it for review again.');
    // The reason is read with the button, so it is heard where the provider acts on it.
    expect(getByName(view, 'button', 'Replace file for Insurance').getAttribute('aria-describedby')).toBe('credential-rejection-insurance');
  });

  it('reads a short reason from another app as a sentence', async () => {
    const view = await render(<Credentials initial={[{ ...rejectedInsurance, rejection_reason: ' Blurred ' }]} />);

    expect(textOf(byId(view, 'credential-rejection-insurance')!)).toBe('Rejected: Blurred. Replace the file to send it for review again.');
  });

  it('still says what to do when the review gave no reason, and a file to attach when there is none', async () => {
    const view = await render(<Credentials initial={[{ ...abnWithoutFile, status: 'rejected', rejection_reason: null }]} />);

    expect(textOf(byId(view, 'credential-rejection-abn')!)).toBe('Attach a file to send it for review again.');
  });

  it('shows no reason on a credential that is not rejected', async () => {
    const view = await render(<Credentials initial={[{ ...verifiedInsurance, rejection_reason: 'An old note' }]} />);

    expect(textOf(view)).not.toContain('An old note');
    expect(byId(view, 'credential-rejection-insurance')).toBeUndefined();
    expect(getByName(view, 'button', 'Attach file for Insurance').hasAttribute('aria-describedby')).toBe(false);
  });
});
