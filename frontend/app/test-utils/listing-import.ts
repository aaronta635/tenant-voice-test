// A listing import as the API answers one (backend schemas/listing_import.py),
// for the tests of lib/listing-import and the wizard's import.
import type { FieldSource, FieldVia, ImportedField, ListingImport } from '@/app/lib/listing-import';

export function importedField<T>(
  value: T,
  source: FieldSource = 'found',
  evidence = 'evidence',
  via: FieldVia = 'structured_data',
): ImportedField<T> {
  return { value, source, evidence, via };
}

/** A field the source did not give. */
export function missingField<T>(): ImportedField<T> {
  return { value: null, source: 'missing', evidence: null, via: null };
}

/** Harbour flat: most fields found, the address split from one line (inferred), the bond and lease missing. */
export const IMPORTED: ListingImport = {
  kind: 'url',
  source_label: 'coast.example',
  source_url: 'https://coast.example/listings/1',
  demo: false,
  fields: {
    title: importedField('Harbour flat', 'found', 'name: Harbour flat'),
    description: importedField('A bright flat by the harbour.', 'found', 'description: A bright flat by the harbour.', 'page_meta'),
    address: importedField('4/1 Harbour Street', 'inferred', '4/1 Harbour Street, Wollongong NSW 2500', 'text'),
    suburb: importedField('Wollongong', 'inferred', '4/1 Harbour Street, Wollongong NSW 2500', 'text'),
    state: importedField('NSW', 'inferred', '4/1 Harbour Street, Wollongong NSW 2500', 'text'),
    postcode: importedField('2500', 'inferred', '4/1 Harbour Street, Wollongong NSW 2500', 'text'),
    property_type: importedField('Apartment', 'found', '@type: Apartment'),
    bedrooms: importedField(2, 'found', 'numberOfBedrooms: 2'),
    bathrooms: importedField(1, 'found', '2 bed, 1 bath', 'text'),
    price: importedField(650, 'found', '$650 per week', 'text'),
    bond: missingField(),
    lease_term: missingField(),
    available_from: importedField('2026-12-01', 'found', 'availabilityStarts: 2026-12-01'),
    amenities: importedField(['Balcony'], 'found', 'amenityFeature: Balcony'),
    pets_allowed: importedField(true, 'found', 'Pets allowed', 'text'),
    floor_area: missingField(),
  },
  counts: { found: 8, inferred: 4, missing: 4 },
  ai_status: 'not_requested',
  message: null,
  verification: null,
};

/** The sample a site that refuses to be read offers, as listing_import.sample_import() answers it. */
export const SAMPLE: ListingImport = {
  ...IMPORTED,
  kind: 'sample',
  source_label: 'Sample listing',
  source_url: null,
  demo: true,
  fields: { ...IMPORTED.fields, title: importedField('Sample listing: 2 bedroom apartment in Wollongong', 'found', 'name: Sample listing') },
};
