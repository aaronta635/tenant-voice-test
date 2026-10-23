// Landlords (R07, R18, R25, R31, R43, R32): an unverified landlord creates a
// listing and is told why it cannot be published, then keeps it unpublished;
// a verified landlord publishes one, finds the applications under a property,
// decides one, sees the providers suggested for the homes, completes a
// tenant's scorecard from the menu and imports a listing from its link.
import { fileURLToPath } from 'node:url';
import { label, role, text } from '../driver.mjs';
import { assert, signIn, visit } from './support.mjs';

const PHOTO = fileURLToPath(new URL('../../public/landing/gallery-4.png', import.meta.url));

/** The three steps of the create-listing wizard, up to the Publish button. */
async function fillListingWizard(page, url, listing) {
  await visit(page, url('/owner/properties/create'));
  await page.fill(label('Listing Title'), listing.title);
  await page.fill(label('Property Address'), listing.address);
  await page.fill(label('City'), listing.suburb);
  await page.fill(label('State'), 'NSW');
  await page.fill(label('Property Type'), 'Apartment');
  await page.fill(label('Postcode'), listing.postcode);
  await page.fill(label('Bedrooms'), '2');
  await page.fill(label('Bathrooms'), '1');
  await page.click(role('button', 'Continue'));
  await page.waitForUrl('/owner/properties/create/photos');
  await page.upload(label('Add listing photos'), PHOTO);
  await page.waitFor(role('img', 'Listing photo 1'));
  await page.fill(label('Description'), listing.description);
  await page.click(role('button', 'Continue'));
  await page.waitForUrl('/owner/properties/create/terms');
  await page.fill(label('Rent (per week)'), String(listing.rent));
  await page.fill(label('Bond / Deposit'), String(listing.rent * 4));
  await page.fill(label('Lease Term'), '12 months');
  await page.expectNoHorizontalScroll();
}

export const landlord = {
  name: 'landlord',
  title: 'Landlord',
  workspace: 'Owner',
  routes: ['/login', '/owner', '/owner/properties', '/owner/properties/create', '/owner/properties/create/photos',
    '/owner/properties/create/terms', '/owner/properties/00000000-0000-4000-8000-000000000000', '/owner/recommendations',
    '/owner/scorecard'],
  async run({ page, step, fixtures, url, web, viewport, expectRequest }) {
    const home = fixtures.listings.newtown;
    const applicant = fixtures.accounts.applicant;
    const draft = { title: 'Bright flat near Leichhardt shops', address: '3 Short Street', suburb: 'Leichhardt',
      postcode: '2040', rent: 610, description: 'Two bedrooms over the shops, a short walk to the light rail.' };
    const published = { title: 'Courtyard unit in Enmore', address: '17 Station Street', suburb: 'Enmore',
      postcode: '2042', rent: 640, description: 'Ground floor unit with a private courtyard and a new kitchen.' };

    await step('An unverified landlord signs in', async () => {
      await signIn(page, web, fixtures, 'landlord_pending');
      await page.waitForUrl(/\/owner$/);
      await page.waitFor(role('heading', 'Welcome back, Peter!'));
      await page.expectNoHorizontalScroll();
    });

    await step('Create a listing with the wizard', async () => {
      await fillListingWizard(page, url, draft);
    });

    await step('Publishing is refused until the account is verified', async () => {
      expectRequest('/api/v1/me/properties', 403, 'the verification gate refuses to publish for an unverified landlord');
      await page.click(role('button', 'Publish Listing'));
      const refusal = role('alert', /Verification needed/);
      await page.waitFor(refusal);
      await page.waitFor(role('link', 'Go to your documents', { within: refusal }));
    });

    await step('The refused listing is kept unpublished', async () => {
      await page.click(role('button', 'Save it unpublished'));
      await page.waitForUrl(/\/owner\/properties\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await page.waitFor(role('heading', draft.title, { level: 1 }));
      await page.waitFor(text('Paused'));
    });

    await step('A verified landlord publishes a listing', async () => {
      await signIn(page, web, fixtures, 'landlord');
      await page.waitFor(role('heading', 'Welcome back, Lena!'));
      await fillListingWizard(page, url, published);
      await page.click(role('button', 'Publish Listing'));
      await page.waitForUrl(/\/owner\/properties\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await page.waitFor(role('heading', published.title, { level: 1 }));
      await page.waitFor(text('Published'));
      await visit(page, url('/properties?q=Enmore'));
      await page.waitFor(role('heading', published.title));
    });

    await step('Applications wait under their property', async () => {
      await visit(page, url(`/owner/properties/${home.id}?tab=applications`));
      await page.waitFor(role('tab', /Applications \(1\)/));
      await page.waitFor(role('heading', applicant.full_name));
      await page.waitFor(text('Nurse at RPA'));
    });

    await step('Approve an application with a note', async () => {
      await page.click(role('button', `Approve ${applicant.full_name}`));
      const dialog = role('dialog', 'Approve this application?');
      await page.fill(label('Note to the applicant (optional)', { within: dialog }), 'Welcome! The lease follows by email this week.');
      await page.click(role('button', 'Approve', { within: dialog }));
      await page.waitForText('Application approved. The applicant has been told, and the listing is now leased.');
      await page.waitFor(role('button', /Approved \(1\)/));
    });

    await step('Providers are suggested for the properties', async () => {
      await visit(page, url('/owner/recommendations'));
      const suggested = role('region', 'Suggested providers');
      await page.waitFor(role('heading', /Okafor Plumbing/, { within: suggested }));
      await page.waitFor(text('Based in Newtown', { within: suggested }));
      await page.waitFor(role('link', /^Request a booking/, { within: suggested }));
    });

    await step("Complete a tenant's scorecard from the menu", async () => {
      const tara = fixtures.accounts.tenant.full_name;
      if (viewport.mobile) await page.click(role('button', 'Open navigation'));
      await page.click(role('link', 'Scorecards'));
      await page.waitForUrl('/owner/scorecard');
      await page.click(role('button', `Complete scorecard for ${tara}`));
      const form = role('form', `Scorecard for ${tara}`);
      for (const item of ['Paid rent on time', 'Looked after the property', 'Communicated respectfully',
        'Followed lease conditions', 'Cooperated with inspections', 'Left property in good condition',
        'Would you rent to this tenant again?']) {
        await page.click(role('radio', '5 out of 5', { within: role('group', item, { within: form }) }));
      }
      await page.fill(label('Comment (optional)', { within: form }), 'Paid on time and left the studio spotless.');
      await page.click(role('button', 'Submit scorecard', { within: form }));
      await page.waitForText(`${tara} has been told.`);
    });

    await step('Import a listing from its link into the wizard', async () => {
      const listing = fixtures.imports;
      await visit(page, url('/owner/properties/create'));
      await page.click(role('button', 'Import from a link or PDF'));
      await page.fill(label('Listing link'), listing.listing);
      await page.click(role('button', 'Read the listing'));
      await page.waitFor(role('heading', 'Check the imported details'));
      await page.waitForText(`From ${new URL(listing.listing).hostname}`);
      await page.click(role('button', 'Use these details'));
      await page.waitFor(role('heading', `Imported from ${new URL(listing.listing).hostname}`));
      // The fields the owner kept are in the form, to check and change before publishing.
      for (const [field, value] of [['Listing Title', listing.title], ['City', listing.suburb], ['Postcode', listing.postcode]]) {
        const shown = await page.value(label(field));
        assert(shown === value, `${field} reads ${JSON.stringify(shown)}, not ${JSON.stringify(value)}`);
      }
    });
  },
};
