// An admin (R16, R17, R40): sign in through the staff sign-in, find an
// account, approve one document and reject another with a reason, hide a
// reported review and restore it, and find the decisions in the activity log.
// An officer signs in there too, to the Housing Portal (R41), and is kept out
// of the console.
import { label, role, text } from '../driver.mjs';
import { signIn, visit } from './support.mjs';

export const admin = {
  name: 'admin',
  title: 'Admin',
  workspace: 'Admin',
  routes: ['/login?account=staff', '/housing', '/admin', '/admin/users', '/admin/users/00000000-0000-4000-8000-000000000000',
    '/admin/verification', '/admin/verification?role=landlord', '/admin/reviews', '/admin/reviews?view=hidden', '/admin/activity'],
  async run({ page, step, fixtures, url, web }) {
    const tom = fixtures.accounts.tenant_pending;
    const peter = fixtures.accounts.landlord_pending;
    const lena = fixtures.accounts.landlord;
    const reviewer = fixtures.accounts.tenant.full_name;

    await step('An officer signs in to the Housing Portal', async () => {
      const officer = fixtures.accounts.officer;
      await visit(page, url('/login?account=staff'));
      await page.waitFor(role('heading', 'Staff sign in', { level: 1 }));
      await page.fill(label('Email'), officer.email);
      await page.fill(label('Password'), fixtures.password);
      await page.click(role('button', 'Sign in as staff'));
      await page.waitForUrl(/\/housing$/);
      await page.waitFor(role('heading', 'Overview', { level: 1 }));
      await page.waitFor(text('Open complaints'));
    });

    await step('The officer is kept out of the admin console', async () => {
      await visit(page, url('/admin'));
      await page.waitFor(role('heading', 'You can\'t open the admin console', { level: 1 }));
      await page.waitFor(text('This area is for TenantVoice administrators.'));
      await page.waitFor(role('link', 'Go to the Housing Portal'));
    });

    await step('Staff sign in', async () => {
      await signIn(page, web, fixtures, 'admin');
      await page.waitForUrl(/\/admin$/);
      await page.waitFor(role('heading', 'Overview', { level: 1 }));
      await page.expectNoHorizontalScroll();
    });

    await step('Find an account among the users', async () => {
      await visit(page, url('/admin/users'));
      await page.waitFor(role('heading', '10 accounts'));
      await page.fill(label('Name or email'), 'lena');
      await page.click(role('button', 'Search', { within: role('search', 'Users') }));
      await page.waitFor(role('heading', '1 account'));
      await page.click(role('link', lena.full_name));
      await page.waitForUrl(`/admin/users/${lena.id}`);
      await page.waitFor(role('heading', lena.full_name, { level: 1 }));
      await page.waitFor(text(lena.email));
    });

    await step('Approve a document in the verification queue', async () => {
      await visit(page, url('/admin/verification'));
      const card = role('article', tom.full_name);
      await page.click(role('button', 'Approve Passport', { within: card }));
      await page.waitForText(`Passport approved. ${tom.full_name}'s account is now verified.`);
    });

    await step('Reject a document with a reason', async () => {
      await page.click(role('link', /^Landlords/, { within: role('navigation', 'Account type') }));
      const card = role('article', peter.full_name);
      await page.click(role('button', 'Reject Proof of ownership', { within: card }));
      const dialog = role('dialog', 'Reject this document');
      await page.fill(label('Reason (required)', { within: dialog }), 'The name on the rates notice does not match the account.');
      await page.click(role('button', 'Reject document', { within: dialog }));
      await page.waitForText(`Proof of ownership rejected. ${peter.full_name} is told why.`);
    });

    await step('Hide a reported review', async () => {
      await visit(page, url('/admin/reviews'));
      await page.waitFor(role('heading', '1 reported review'));
      await page.click(role('button', `Hide ${reviewer}'s review`));
      const dialog = role('dialog', 'Hide this review');
      await page.fill(label('Reason (required)', { within: dialog }), 'It names a private matter between the tenant and the landlord.');
      await page.click(role('button', 'Hide review', { within: dialog }));
      await page.waitForText(`The review was hidden. ${reviewer} was told why.`);
    });

    await step('Restore the hidden review', async () => {
      await page.click(role('link', /^Hidden/, { within: role('navigation', 'Review views') }));
      await page.click(role('button', `Restore ${reviewer}'s review`));
      const dialog = role('dialog', 'Restore this review');
      await page.fill(label('Reason (required)', { within: dialog }), 'On a second look it is a fair account of the tenancy.');
      await page.click(role('button', 'Restore review', { within: dialog }));
      await page.waitForText('The review was restored.');
    });

    await step('The activity log shows the decisions', async () => {
      await visit(page, url('/admin/activity'));
      // Reports go into the review through mobile_report_review, so the log holds the decisions only.
      await page.waitFor(text('review.moderated'));
    });
  },
};
