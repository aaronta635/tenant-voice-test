// Listing auto-fill (R32): a listing read from a link or a PDF into the
// create-listing wizard's draft (backend services/listing_import.py,
// docs/listing-import.md). The server reads the source and says, for each
// field, whether it found the value, inferred it or found nothing. The owner
// keeps the fields they want; nothing is saved until the listing is
// published at the end of the wizard.

import { ApiError, apiFetch } from './api';
import { formatDate, formatMoney } from './format';
import { MAX_FEATURES, MAX_FEATURE_LENGTH } from './listings';
import { getDraft, type ListingDraft } from './owner-listing-draft';

export type FieldSource = 'found' | 'inferred' | 'missing';
/** Where a value was read: the page's structured data, its tags and title, the text, the PDF's properties or the model. */
export type FieldVia = 'structured_data' | 'page_meta' | 'text' | 'pdf_metadata' | 'ai';

export type ImportedField<T> = {
  value: T | null;
  source: FieldSource;
  /** The snippet the value came from, as the source has it. */
  evidence: string | null;
  via: FieldVia | null;
};

export type ImportedFields = {
  title: ImportedField<string>;
  description: ImportedField<string>;
  /** The street line. */
  address: ImportedField<string>;
  suburb: ImportedField<string>;
  state: ImportedField<string>;
  postcode: ImportedField<string>;
  property_type: ImportedField<string>;
  bedrooms: ImportedField<number>;
  bathrooms: ImportedField<number>;
  /** Dollars a week. */
  price: ImportedField<number>;
  bond: ImportedField<number>;
  lease_term: ImportedField<string>;
  /** YYYY-MM-DD. */
  available_from: ImportedField<string>;
  amenities: ImportedField<string[]>;
  pets_allowed: ImportedField<boolean>;
  /** Square metres. */
  floor_area: ImportedField<number>;
};

export type ImportFieldKey = keyof ImportedFields;

export type ImportAiStatus =
  | 'not_requested'
  | 'not_configured'
  | 'not_needed'
  | 'applied'
  | 'unavailable'
  | 'cooldown'
  | 'verification_required';

export type ListingImport = {
  kind: 'url' | 'pdf' | 'sample';
  /** The site's host, the PDF's name, or "Sample listing". */
  source_label: string;
  source_url: string | null;
  /** The sample offered for a site that refuses to be read: not the owner's listing. */
  demo: boolean;
  fields: ImportedFields;
  counts: Record<FieldSource, number>;
  ai_status: ImportAiStatus;
  message: string | null;
  /** The gate's refusal when the model was asked for and the account may not use it (read it with refusalOf). */
  verification: unknown;
};

/** The largest PDF the import reads (backend MAX_PDF_BYTES). */
export const MAX_IMPORT_PDF_BYTES = 10 * 1024 * 1024;

export function importListingFromUrl(url: string, useAi: boolean): Promise<ListingImport> {
  return apiFetch<ListingImport>('/me/listing-imports/url', { method: 'POST', body: { url, use_ai: useAi } });
}

export function importListingFromPdf(file: File, useAi: boolean): Promise<ListingImport> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('use_ai', useAi ? 'true' : 'false');
  return apiFetch<ListingImport>('/me/listing-imports/pdf', { method: 'POST', formData });
}

// ---------------------------------------------------------------------------
// When an import fails
// ---------------------------------------------------------------------------
export type ImportFailureCode =
  | 'blocked'
  | 'too_large'
  | 'not_a_listing'
  | 'timeout'
  | 'invalid_url'
  | 'port_not_allowed'
  | 'address_not_allowed'
  | 'too_many_redirects'
  | 'not_found'
  | 'unsupported_content'
  | 'unreachable'
  | 'unreadable_pdf'
  | 'no_text'
  | 'invalid_file'
  | 'busy'
  | 'other';

export type ImportFailure = {
  code: ImportFailureCode;
  /** What went wrong, in a few words. */
  title: string;
  /** What to do, from the server when it said. */
  message: string;
  /** For a site that refuses to be read: the sample the owner may try, labelled a demo. */
  sample: ListingImport | null;
};

const FAILURES: Record<ImportFailureCode, { title: string; message: string }> = {
  blocked: {
    title: "This site doesn't allow imports",
    message: 'Save the listing as a PDF (print it to PDF from your browser) and upload that, or type the details below.',
  },
  too_large: { title: 'Too large to read', message: 'PDFs can be up to 10 MB, and pages up to 2 MB. Type the details below instead.' },
  not_a_listing: {
    title: 'No listing found there',
    message: "We couldn't find a listing's details. Check the link opens the listing itself, or type the details below.",
  },
  timeout: { title: 'The site took too long', message: 'Try again, or upload the listing as a PDF.' },
  invalid_url: { title: "That link can't be read", message: 'Paste the whole link to the listing, starting with https://.' },
  port_not_allowed: { title: "That link can't be read", message: 'Only links on the standard web ports can be imported.' },
  address_not_allowed: {
    title: "That link can't be read",
    message: 'It points to a private or local network address, which is never imported.',
  },
  too_many_redirects: { title: "That link can't be read", message: "It redirects too many times. Paste the listing's own link." },
  not_found: { title: 'Page not found', message: 'Check the link, or type the details below.' },
  unsupported_content: { title: "That can't be read", message: 'Choose a listing page, or its PDF.' },
  unreachable: { title: "We couldn't reach that site", message: 'Check the link, or upload the listing as a PDF.' },
  unreadable_pdf: {
    title: "That PDF can't be read",
    message: 'It may be damaged or protected with a password. Save it again without one, or type the details below.',
  },
  no_text: { title: 'No text in that PDF', message: 'It may be a scan. Type the details below.' },
  invalid_file: { title: 'No PDF chosen', message: 'Choose the listing PDF to import.' },
  busy: { title: 'An import is still running', message: 'Wait for it to finish, then try again.' },
  other: { title: "The import didn't work", message: 'Try again, or type the details below.' },
};

function isListingImport(value: unknown): value is ListingImport {
  if (typeof value !== 'object' || value === null) return false;
  const { fields, demo, source_label: label } = value as Record<string, unknown>;
  return typeof fields === 'object' && fields !== null && typeof demo === 'boolean' && typeof label === 'string';
}

/** What a failed import should show; the form stays as it was. */
export function importFailure(error: unknown): ImportFailure {
  const detail = error instanceof ApiError && typeof error.detail === 'object' && error.detail !== null
    ? (error.detail as Record<string, unknown>)
    : {};
  const code = typeof detail.code === 'string' && detail.code in FAILURES ? (detail.code as ImportFailureCode) : 'other';
  const known = FAILURES[code];
  const said = typeof detail.message === 'string' && detail.message.trim() && !/[<>]/.test(detail.message) ? detail.message : null;
  // A refusal before the import (signed out, another role) or a network failure says why in the error itself.
  const message = said ?? (code === 'other' && error instanceof ApiError && error.message ? error.message : known.message);
  return { code, title: known.title, message, sample: isListingImport(detail.sample) ? detail.sample : null };
}

/** A pasted link as it is sent: one without a scheme ("www.example.com/listing/1") is taken as https. */
export function linkToRead(link: string): string {
  const trimmed = link.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || !trimmed ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
}

/** Why an import cannot be sent yet: no link, no file, or a file that is no PDF or too large; null when it can. */
export function inputRefusal(mode: 'url' | 'pdf', link: string, file: File | null): ImportFailure | null {
  if (mode === 'url') {
    return link.trim() ? null : { code: 'invalid_url', title: 'No link yet', message: 'Paste the link to the listing.', sample: null };
  }
  return file ? pdfRefusal(file) : { code: 'invalid_file', ...FAILURES.invalid_file, sample: null };
}

/** Why a chosen file cannot be imported, before anything is sent; null when it can. */
export function pdfRefusal(file: File): ImportFailure | null {
  const named = /\.pdf$/i.test(file.name);
  if (file.type !== 'application/pdf' && !named) {
    return { code: 'unsupported_content', title: "That isn't a PDF", message: 'Choose the listing PDF, or type the details below.', sample: null };
  }
  if (file.size > MAX_IMPORT_PDF_BYTES) {
    return { code: 'too_large', title: 'Too large to read', message: 'That PDF is larger than 10 MB. Choose a smaller file, or type the details below.', sample: null };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The fields, as the wizard has them
// ---------------------------------------------------------------------------
export type WizardStep = 'details' | 'photos' | 'terms';

export const WIZARD_STEPS: { step: WizardStep; label: string }[] = [
  { step: 'details', label: 'Property Details' },
  { step: 'photos', label: 'Photos & Description' },
  { step: 'terms', label: 'Rental Terms' },
];

/** Every imported field, with the wizard's label and the step it is on. */
export const IMPORT_FIELDS: { key: ImportFieldKey; label: string; step: WizardStep }[] = [
  { key: 'title', label: 'Listing title', step: 'details' },
  { key: 'address', label: 'Property address', step: 'details' },
  { key: 'suburb', label: 'City', step: 'details' },
  { key: 'state', label: 'State', step: 'details' },
  { key: 'postcode', label: 'Postcode', step: 'details' },
  { key: 'property_type', label: 'Property type', step: 'details' },
  { key: 'bedrooms', label: 'Bedrooms', step: 'details' },
  { key: 'bathrooms', label: 'Bathrooms', step: 'details' },
  { key: 'description', label: 'Description', step: 'photos' },
  { key: 'amenities', label: 'Amenities', step: 'photos' },
  { key: 'pets_allowed', label: 'Pets', step: 'photos' },
  { key: 'floor_area', label: 'Floor area', step: 'photos' },
  { key: 'price', label: 'Rent (per week)', step: 'terms' },
  { key: 'bond', label: 'Bond / deposit', step: 'terms' },
  { key: 'lease_term', label: 'Lease term', step: 'terms' },
  { key: 'available_from', label: 'Available from', step: 'terms' },
];

export const SOURCE_LABELS: Record<FieldSource, string> = { found: 'Found', inferred: 'Inferred', missing: 'Missing' };

/** Where the evidence came from, after "From the". */
export const VIA_LABELS: Record<FieldVia, string> = {
  structured_data: "listing's data",
  page_meta: "page's details",
  text: 'text',
  pdf_metadata: "PDF's details",
  ai: 'text, read by AI',
};

/** The feature a pets answer adds; a "no" adds none. */
export const PETS_FEATURE = 'Pet friendly';

export function floorAreaFeature(area: number): string {
  return `Floor area ${Number.isInteger(area) ? area : area.toFixed(1)} m²`;
}

/** A field's value as the review shows it; empty when missing. */
export function displayValue(key: ImportFieldKey, fields: ImportedFields): string {
  const { value } = fields[key];
  if (value === null || value === undefined) return '';
  switch (key) {
    case 'price':
      return formatMoney(value as number, ' a week');
    case 'bond':
      return formatMoney(value as number);
    case 'available_from':
      return formatDate(value as string);
    case 'amenities':
      return (value as string[]).join(', ');
    case 'pets_allowed':
      return value ? `Allowed: adds "${PETS_FEATURE}" to the amenities` : 'Not allowed: adds nothing';
    case 'floor_area':
      return `${value} m²: adds "${floorAreaFeature(value as number)}" to the amenities`;
    case 'description': {
      const text = value as string;
      return text.length > 280 ? `${text.slice(0, 279).trimEnd()}…` : text;
    }
    default:
      return String(value);
  }
}

/** The fields the review starts with ticked: every one with a value. */
export function fieldsWithValues(result: ListingImport): ImportFieldKey[] {
  return IMPORT_FIELDS.map(({ key }) => key).filter((key) => result.fields[key].source !== 'missing');
}

// The imported fields the draft keeps as they are, and those it keeps as text.
const TEXT_FIELDS = [
  'title', 'address', 'suburb', 'state', 'postcode', 'property_type', 'description', 'lease_term', 'available_from',
] as const;
const NUMBER_FIELDS = ['bedrooms', 'bathrooms', 'price', 'bond'] as const;

/**
 * The draft fields the chosen imported fields fill. A field left out keeps
 * the draft's value. Pets and the floor area become amenities, added after
 * the draft's own, up to what a listing keeps.
 */
export function importedDraft(result: ListingImport, chosen: ImportFieldKey[], draft: ListingDraft): Partial<ListingDraft> {
  const { fields } = result;
  const kept = new Set(chosen.filter((key) => fields[key].source !== 'missing'));
  const patch: Partial<ListingDraft> = {};
  for (const key of TEXT_FIELDS) {
    const text = fields[key].value;
    if (kept.has(key) && text?.trim()) patch[key] = text;
  }
  for (const key of NUMBER_FIELDS) {
    const number = fields[key].value;
    if (kept.has(key) && typeof number === 'number') patch[key] = String(number);
  }
  const features = kept.has('amenities') ? [...(fields.amenities.value ?? [])] : [];
  if (kept.has('pets_allowed') && fields.pets_allowed.value === true) features.push(PETS_FEATURE);
  const area = fields.floor_area.value;
  if (kept.has('floor_area') && typeof area === 'number') features.push(floorAreaFeature(area));
  if (features.length > 0) {
    const amenities = new Map<string, string>();
    for (const feature of [...(draft.amenities ?? []), ...features]) {
      const name = feature.trim();
      if (name && name.length <= MAX_FEATURE_LENGTH && !amenities.has(name.toLowerCase())) amenities.set(name.toLowerCase(), name);
    }
    patch.amenities = [...amenities.values()].slice(0, MAX_FEATURES);
  }
  return patch;
}

// ---------------------------------------------------------------------------
// What the wizard keeps of an import
// ---------------------------------------------------------------------------
export type ImportSummary = {
  source_label: string;
  kind: ListingImport['kind'];
  demo: boolean;
  /** Every field, in the wizard's order: where its value came from and whether the owner kept it. */
  fields: { key: ImportFieldKey; source: FieldSource; used: boolean }[];
};

const SUMMARY_KEY = 'tv_listing_import';

export function summaryOf(result: ListingImport, chosen: ImportFieldKey[]): ImportSummary {
  const used = new Set(chosen);
  return {
    source_label: result.source_label,
    kind: result.kind,
    demo: result.demo,
    fields: IMPORT_FIELDS.map(({ key }) => ({
      key,
      source: result.fields[key].source,
      used: used.has(key) && result.fields[key].source !== 'missing',
    })),
  };
}

/** Kept beside the draft for this tab, so the marks stay while the owner moves between the steps. */
export function saveImportSummary(summary: ImportSummary) {
  try {
    sessionStorage.setItem(SUMMARY_KEY, JSON.stringify(summary));
  } catch {
    // Storage may be full or blocked: the form keeps the details all the same.
  }
}

/** The last import's summary, while its draft is still in progress; a summary whose draft was published is dropped. */
export function getImportSummary(): ImportSummary | null {
  try {
    const stored = sessionStorage.getItem(SUMMARY_KEY);
    if (!stored) return null;
    if (Object.keys(getDraft()).length === 0) {
      sessionStorage.removeItem(SUMMARY_KEY);
      return null;
    }
    const summary = JSON.parse(stored) as ImportSummary;
    return Array.isArray(summary?.fields) && typeof summary.source_label === 'string' ? summary : null;
  } catch {
    return null;
  }
}
