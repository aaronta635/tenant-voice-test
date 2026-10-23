// A verified service provider (R03, R04, R33): sign in, see and add services,
// find the incoming booking and confirm it, and book the visit of a repair an
// owner assigned, which only then shows its access notes.
import { label, role, text } from '../driver.mjs';
import { signIn, visit } from './support.mjs';

/** A Sydney calendar date days from now, as a date input takes it (YYYY-MM-DD). */
function sydneyDate(days) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date(Date.now() + days * 86_400_000));
}

export const provider = {
  name: 'provider',
  title: 'Service provider',
  workspace: 'Provider',
  routes: ['/login', '/dashboard', '/dashboard/services', '/dashboard/bookings', '/dashboard/repairs'],
  async run({ page, step, fixtures, url, web }) {
    const tara = fixtures.accounts.tenant;

    await step('Sign in as a service provider', async () => {
      await signIn(page, web, fixtures, 'provider');
      await page.waitForUrl(/\/dashboard$/);
      await page.waitFor(role('heading', 'Overview', { level: 1 }));
      await page.waitForText('Welcome back, Sam');
      await page.expectNoHorizontalScroll();
    });

    await step('Services are listed, and a new one is added', async () => {
      await visit(page, url('/dashboard/services'));
      for (const title of ['Blocked drain clearing', 'Leaking tap repair', 'Hot water system check']) {
        await page.waitFor(role('button', `Edit ${title}`));
      }
      await page.click(role('button', 'Add new service'));
      const editor = role('dialog', 'Add a service');
      await page.fill(label('Service name', { within: editor }), 'Gas fitting check');
      // An active service needs a description (mobile_service_validate).
      await page.fill(label('Description', { within: editor }), 'A safety check of the gas fittings and appliances.');
      await page.fill(label('Price (AUD)', { within: editor }), '160');
      await page.fill(label('Typical duration (minutes)', { within: editor }), '60');
      await page.fill(label('Service area', { within: editor }), 'Inner West');
      await page.click(role('button', 'Add service', { within: editor }));
      await page.waitForText('Gas fitting check added.');
      await page.waitFor(role('button', 'Edit Gas fitting check'));
    });

    await step('An incoming booking waits for an answer', async () => {
      await visit(page, url('/dashboard/bookings'));
      await page.click(role('button', /^New enquiry \(1\)/, { within: role('group', 'Booking status') }));
      await page.waitFor(role('heading', tara.full_name));
      await page.waitFor(role('button', `Accept booking for ${tara.full_name}`));
    });

    await step('Confirm the booking', async () => {
      await page.click(role('button', `Accept booking for ${tara.full_name}`));
      const dialog = role('dialog', 'Accept booking?');
      await page.waitFor(text('Leaking tap repair', { within: dialog }));
      await page.click(role('button', 'Confirm change', { within: dialog }));
      await page.waitFor(role('button', /^Confirmed \(2\)/, { within: role('group', 'Booking status') }));
      await page.waitFor(role('button', /^New enquiry \(0\)/, { within: role('group', 'Booking status') }));
    });

    await step('An assigned repair gets its visit booked', async () => {
      await visit(page, url('/dashboard/repairs'));
      await page.waitFor(role('heading', 'Leaking kitchen tap'));
      await page.click(role('button', 'Book visit for Leaking kitchen tap'));
      const form = role('form', 'Visit for Leaking kitchen tap');
      await page.fill(label('Day', { within: form }), sydneyDate(2));
      await page.fill(label('Start time', { within: form }), '10:00');
      await page.click(role('button', 'Book visit', { within: form }));
      await page.waitForText('The tenant and the owner have been told.');
      // The access notes reach the provider only once the visit is booked.
      await page.waitFor(text('Key in the lockbox, code 4471.'));
    });
  },
};
