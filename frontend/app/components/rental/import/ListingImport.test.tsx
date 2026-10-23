import { cleanup, click, descendants, dispatch, getByName, render, settle, textOf, typeInto, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { field, tick } from '@/app/test-utils/onboarding';
import { IMPORTED, SAMPLE, importedField, missingField } from '@/app/test-utils/listing-import';
import ListingImport from './ListingImport';

vi.mock('next/link', async () => ({ default: (await import('@/app/test-utils/fake-link')).fakeLink(() => {}) }));

const DRAFT_KEY = 'tv_listing_draft';
const SUMMARY_KEY = 'tv_listing_import';
const fetchMock = vi.fn();

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function answer(status: number, body: unknown) {
  fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status }));
}

const refusal = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  answer(status, { detail: { code, message, ...extra } });

function sent() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init };
}

const alertOf = (view: FakeElement) => descendants(view).find((element) => element.getAttribute('role') === 'alert');
const heading = (view: FakeElement, text: string | RegExp) =>
  descendants(view).find((element) => /^H[1-3]$/.test(element.tagName) && (typeof text === 'string' ? textOf(element) === text : text.test(textOf(element))));
/** The review row of a field: its list item, by the field's name. */
const row = (view: FakeElement, name: string) =>
  descendants(view).find((element) => element.tagName === 'LI' && textOf(element).startsWith(name)) as FakeElement;

async function openImport(view: FakeElement) {
  await click(getByName(view, 'button', 'Import from a link or PDF'));
}

async function readLink(view: FakeElement, link = 'coast.example/listings/1') {
  await typeInto(field(view, 'Listing link'), link);
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
  await settle();
}

async function readPdf(view: FakeElement, file: File) {
  await click(getByName(view, 'button', 'The listing as a PDF'));
  const input = field(view, 'Listing PDF');
  input.files = [file];
  await dispatch(input, 'change');
  await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
  await settle();
}

const draft = () => JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}');
const pdf = (name = 'listing.pdf', bytes = 8, type = 'application/pdf') => new File([new Uint8Array(bytes)], name, { type });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('sessionStorage', memoryStorage());
});
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe('importing a listing into the new listing wizard', () => {
  it('reads a link and shows each field found, inferred or missing, with where it came from', async () => {
    answer(200, IMPORTED);
    const view = await render(<ListingImport onUse={vi.fn()} />);

    await openImport(view);
    await readLink(view);

    const { url, init } = sent();
    expect(url).toMatch(/\/me\/listing-imports\/url$/);
    expect(JSON.parse(init.body as string)).toEqual({ url: 'https://coast.example/listings/1', use_ai: false });
    const review = heading(view, 'Check the imported details') as FakeElement;
    expect(document.activeElement).toBe(review);
    expect(textOf(view)).toContain('From coast.example: 8 found, 4 inferred, 4 missing.');
    expect(textOf(view)).toContain('Photos are never copied from the listing.');
    expect(textOf(row(view, 'Listing title'))).toBe('Listing titleFoundHarbour flatFrom the listing\'s data: “name: Harbour flat”');
    expect(textOf(row(view, 'City'))).toContain('Inferred');
    expect(textOf(row(view, 'City'))).toContain('Worked out from this, so check it.');
    expect(textOf(row(view, 'Bond / deposit'))).toBe('Bond / depositMissingNot in the listing: type it in the form on the Rental Terms step.');
    expect(textOf(row(view, 'Rent (per week)'))).toContain('$650 a week');
    expect(field(view, 'Listing title').checked).toBe(true);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('moves focus to the review even when a frame comes before the answer is rendered', async () => {
    // The answer arrives after an await, so React may render it after the next frame: a frame
    // callback that ran first found no review heading, and focus stayed on the removed link field.
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
    answer(200, IMPORTED);
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);

    await readLink(view);

    expect(document.activeElement).toBe(heading(view, 'Check the imported details'));
  });

  it('leaves focus where the owner moved it while the listing was read', async () => {
    let finish: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const outside = document.body.appendChild(document.createElement('input')) as unknown as FakeElement;
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);
    await readLink(view);

    outside.focus();
    finish(new Response(JSON.stringify(IMPORTED), { status: 200 }));
    await settle();

    expect(heading(view, 'Check the imported details')).toBeDefined();
    expect(document.activeElement).toBe(outside);
  });

  it('puts only the ticked fields in the draft and marks every field in its summary', async () => {
    answer(200, IMPORTED);
    const onUse = vi.fn();
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ amenities: ['Garden'] }));
    const view = await render(<ListingImport onUse={onUse} />);
    await openImport(view);
    await readLink(view);

    await tick(view, 'Rent (per week)');
    await click(getByName(view, 'button', 'Use these details'));
    await settle();

    const [[details]] = onUse.mock.calls;
    expect(details).toEqual({
      title: 'Harbour flat', description: 'A bright flat by the harbour.', address: '4/1 Harbour Street',
      suburb: 'Wollongong', state: 'NSW', postcode: '2500', property_type: 'Apartment', bedrooms: '2', bathrooms: '1',
      available_from: '2026-12-01', amenities: ['Garden', 'Balcony', 'Pet friendly'],
    });
    expect(draft()).toEqual(details);
    const summary = heading(view, 'Imported from coast.example') as FakeElement;
    expect(document.activeElement).toBe(summary);
    const marks = Object.fromEntries(descendants(view).filter((element) => element.tagName === 'LI').map((item) => {
      const [label, ...rest] = item.childNodes.map((node) => node.textContent);
      return [label, rest.join('')];
    }));
    expect(marks).toMatchObject({ 'Listing title': 'Found', City: 'Inferred', 'Rent (per week)': 'Not used', 'Bond / deposit': 'Missing' });
    expect(JSON.parse(sessionStorage.getItem(SUMMARY_KEY) ?? '{}').source_label).toBe('coast.example');
    expect(lowContrastText(view)).toEqual([]);
  });

  it('reads a PDF, and asks the AI only when the owner ticks it', async () => {
    answer(200, { ...IMPORTED, kind: 'pdf', source_label: 'listing.pdf' });
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);

    await tick(view, 'Also let AI read it for anything we miss');
    await readPdf(view, pdf());

    const { url, init } = sent();
    expect(url).toMatch(/\/me\/listing-imports\/pdf$/);
    const form = init.body as FormData;
    expect((form.get('file') as File).name).toBe('listing.pdf');
    expect(form.get('use_ai')).toBe('true');
    expect(textOf(view)).toContain('From listing.pdf');
  });

  it.each([
    ['photo.jpg', 10, 'image/jpeg', "That isn't a PDF"],
    ['huge.pdf', 10 * 1024 * 1024 + 1, 'application/pdf', 'Too large to read'],
  ])('refuses %s before sending it', async (name, bytes, type, title) => {
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);

    await readPdf(view, pdf(name, bytes, type));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(textOf(alertOf(view) as FakeElement)).toContain(title);
  });

  it.each([
    ['the owner switches to a link and back', async (view: FakeElement) => {
      await click(getByName(view, 'button', 'A link to the listing'));
      await click(getByName(view, 'button', 'The listing as a PDF'));
    }],
    ['the owner starts again from the review', async (view: FakeElement) => {
      answer(200, { ...IMPORTED, kind: 'pdf', source_label: 'private-lease.pdf' });
      await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
      await settle();
      await click(getByName(view, 'button', 'Start again'));
      fetchMock.mockClear();
    }],
    ['the owner cancels and opens the import again', async (view: FakeElement) => {
      await click(getByName(view, 'button', 'Cancel'));
      await openImport(view);
    }],
  ])('sends no PDF the form no longer shows after %s', async (_case, leave) => {
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);
    await click(getByName(view, 'button', 'The listing as a PDF'));
    const input = field(view, 'Listing PDF');
    input.files = [pdf('private-lease.pdf')];
    await dispatch(input, 'change');

    await leave(view);
    await dispatch(descendants(view).find((element) => element.tagName === 'FORM') as FakeElement, 'submit');
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(textOf(alertOf(view) as FakeElement)).toContain('No PDF chosen');
  });

  it('asks for a link before reading', async () => {
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);

    await readLink(view, '   ');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(textOf(alertOf(view) as FakeElement)).toBe('No link yetPaste the link to the listing.Upload a PDF instead');
  });

  it.each([
    [413, 'too_large', 'That page is larger than 2 MB, too large to read.', 'Too large to read'],
    [422, 'not_a_listing', "We couldn't find a listing's details at that link.", 'No listing found there'],
    [504, 'timeout', 'That site took too long to answer.', 'The site took too long'],
    [422, 'address_not_allowed', 'That link points to a private or local network address.', "That link can't be read"],
  ])('a %s %s failure says why and leaves everything as it was', async (status, code, message, title) => {
    refusal(status, code, message);
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title: 'Typed by hand' }));
    const onUse = vi.fn();
    const view = await render(<ListingImport onUse={onUse} />);
    await openImport(view);

    await readLink(view);

    expect(textOf(alertOf(view) as FakeElement)).toBe(`${title}${message}Upload a PDF instead`);
    expect(onUse).not.toHaveBeenCalled();
    expect(draft()).toEqual({ title: 'Typed by hand' });
    const input = field(view, 'Listing link');
    expect([input.value, input.hasAttribute('disabled')]).toEqual(['coast.example/listings/1', false]);
    expect(getByName(view, 'button', 'Read the listing').hasAttribute('disabled')).toBe(false);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('for a site that refuses reading, offers the PDF and a sample labelled a demo', async () => {
    const message = "realestate.com.au doesn't let other sites read its listings. Save the listing as a PDF, or type the details below.";
    refusal(422, 'blocked', message, { sample: SAMPLE });
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);
    await readLink(view, 'https://www.realestate.com.au/property-1');

    expect(textOf(alertOf(view) as FakeElement)).toBe(`This site doesn't allow imports${message}Upload a PDF insteadTry a sample import (demo)`);

    await click(getByName(view, 'button', 'Try a sample import (demo)'));
    await settle();

    expect(heading(view, 'Check the imported details')).toBeDefined();
    const label = descendants(view).find((element) => element.hasAttribute('data-demo-label')) as FakeElement;
    expect(textOf(label)).toMatch(/^Demo: Sample import: these details are a made-up listing, not the one you linked\./);
    expect(textOf(view)).toContain('From Sample listing');
  });

  it('switches to the PDF when the owner takes that way round a site that cannot be read', async () => {
    refusal(422, 'blocked', 'That site refused to share the page with TenantVoice.');
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);
    await readLink(view);

    await click(getByName(view, 'button', 'Upload a PDF instead'));
    await settle();

    expect(getByName(view, 'button', 'The listing as a PDF').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(field(view, 'Listing PDF'));
    expect(alertOf(view)).toBeUndefined();
  });

  it('shows why the AI did not read it, beside the rule result', async () => {
    const gate = {
      code: 'verification_required', action: 'paid_ai', status: 'pending', documents_href: '/owner/profile/verification',
      message: 'Your account needs to be verified before you can use AI features.',
    };
    answer(200, { ...IMPORTED, ai_status: 'verification_required', verification: gate, message: 'AI reading needs a verified account.' });
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);
    await tick(view, 'Also let AI read it for anything we miss');

    await readLink(view);

    expect(textOf(view)).toContain(gate.message);
    expect(getByName(view, 'a', 'Go to your documents').getAttribute('href')).toBe('/owner/profile/verification');
  });

  it('marks what the AI read as such', async () => {
    answer(200, { ...IMPORTED, ai_status: 'applied', message: 'AI read the listing too and filled 1 more detail, each marked inferred.',
      fields: { ...IMPORTED.fields, bond: importedField(2600, 'inferred', 'the bond is two thousand six hundred, $2,600', 'ai') } });
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);

    await readLink(view);

    expect(textOf(row(view, 'Bond / deposit'))).toBe(
      'Bond / depositInferred$2,600From the text, read by AI: “the bond is two thousand six hundred, $2,600” Check it against the listing.',
    );
    expect(textOf(view)).toContain('AI read the listing too and filled 1 more detail');
  });

  it('drops an answer that comes after the import was cancelled', async () => {
    let finish: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { finish = done; }));
    const onUse = vi.fn();
    const view = await render(<ListingImport onUse={onUse} />);
    await openImport(view);
    await readLink(view);
    expect(textOf(view)).toContain('Reading the listing…');

    await click(getByName(view, 'button', 'Cancel'));
    finish(new Response(JSON.stringify(IMPORTED), { status: 200 }));
    await settle();

    expect(heading(view, 'Check the imported details')).toBeUndefined();
    expect(getByName(view, 'button', 'Import from a link or PDF')).toBeDefined();
    expect(onUse).not.toHaveBeenCalled();
  });

  it('goes back to the link from the review without using anything', async () => {
    answer(200, IMPORTED);
    const onUse = vi.fn();
    const view = await render(<ListingImport onUse={onUse} />);
    await openImport(view);
    await readLink(view);

    await click(getByName(view, 'button', 'Start again'));
    await settle();

    expect(field(view, 'Listing link').value).toBe('coast.example/listings/1');
    expect(onUse).not.toHaveBeenCalled();
    expect(draft()).toEqual({});
  });

  it('cannot use an import with every field unticked', async () => {
    answer(200, { ...IMPORTED, fields: { ...Object.fromEntries(Object.keys(IMPORTED.fields).map((key) => [key, missingField()])), title: IMPORTED.fields.title } });
    const view = await render(<ListingImport onUse={vi.fn()} />);
    await openImport(view);
    await readLink(view);

    await tick(view, 'Listing title');

    expect(getByName(view, 'button', 'Use these details').hasAttribute('disabled')).toBe(true);
  });

  it('shows the summary of an import while its draft is in progress, and a sample as a demo', async () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title: 'Sample listing' }));
    sessionStorage.setItem(SUMMARY_KEY, JSON.stringify({
      source_label: 'Sample listing', kind: 'sample', demo: true,
      fields: [{ key: 'title', source: 'found', used: true }, { key: 'bond', source: 'missing', used: false }],
    }));

    const view = await render(<ListingImport onUse={vi.fn()} />);

    expect(heading(view, 'Imported from Sample listing')).toBeDefined();
    expect(descendants(view).some((element) => element.hasAttribute('data-demo-label'))).toBe(true);
    await click(getByName(view, 'button', 'Import again'));
    expect(field(view, 'Listing link')).toBeDefined();
  });

  it('offers a new import once the draft it filled is published', async () => {
    sessionStorage.setItem(SUMMARY_KEY, JSON.stringify({ source_label: 'coast.example', kind: 'url', demo: false, fields: [] }));

    const view = await render(<ListingImport onUse={vi.fn()} />);

    expect(getByName(view, 'button', 'Import from a link or PDF')).toBeDefined();
    expect(sessionStorage.getItem(SUMMARY_KEY)).toBeNull();
  });
});
