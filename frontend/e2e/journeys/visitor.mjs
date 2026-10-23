// A visitor, signed out (R20, R22, R42, R25): search from the homepage, browse
// profiles, open a tenant's public profile, which shows placeholders where the
// private details are and holds none of them, follow its sign-up prompt, see a
// listing without photos say so, and reset a password through the emailed link.
import { css, label, role, text } from '../driver.mjs';
import { assert, expectNone, signIn, visit } from './support.mjs';

const NEW_PASSWORD = 'Fresh-pass-2026';

export const visitor = {
  name: 'visitor',
  title: 'Visitor',
  routes: ['/', '/search?type=profiles&role=all', '/public/00000000-0000-4000-8000-000000000000', '/register', '/forgot-password', '/reset-password', '/login', '/properties'],
  async run({ page, step, fixtures, url, api, web }) {
    const tara = fixtures.accounts.tenant;
    const lena = fixtures.accounts.landlord;

    await step('Search profiles from the homepage', async () => {
      await visit(page, url('/'));
      await page.waitFor(role('heading', 'Rent, list and maintain property with confidence.', { level: 1 }));
      const search = role('search', 'Search TenantVoice');
      await page.choose(label('Search for', { within: search }), 'Profiles');
      await page.fill(label('Keywords', { within: search }), 'Lena');
      await page.click(role('button', 'Search', { within: search }));
      await page.waitForUrl(/\/search\?.*q=Lena/);
      await page.waitFor(role('link', `View profile: ${lena.full_name}`));
      await page.expectNoHorizontalScroll();
    });

    await step('Browse profiles of every role, then tenants only', async () => {
      await visit(page, url('/search?type=profiles&role=all'));
      for (const name of ['Okafor Plumbing', lena.full_name, 'Tara N.']) await page.waitFor(role('link', `View profile: ${name}`));
      await page.click(role('button', 'Tenants', { within: role('group', 'Profile type') }));
      await page.waitForGone(role('link', `View profile: ${lena.full_name}`));
      await page.waitFor(role('link', 'View profile: Tara N.'));
      await page.expectNoHorizontalScroll();
    });

    await step('A public profile shows placeholders and no private details', async () => {
      await page.click(role('link', 'View profile: Tara N.'));
      await page.waitForUrl(`/public/${tara.id}`);
      await page.waitFor(role('heading', 'Tara N.', { level: 1 }));
      await page.waitFor(role('region', 'Private details'));
      const placeholders = await page.evaluate(() => document.querySelectorAll('[data-private-placeholder]').length);
      assert(placeholders === 5, `expected 5 private placeholders, found ${placeholders}`);
      await expectNone(page, [tara.full_name, ...fixtures.private.tenant], "Tara's public profile");
      await page.expectNoHorizontalScroll();
    });

    await step('The profile asks a visitor to sign in or sign up', async () => {
      await page.waitFor(text('Sign in or create an account to see more'));
      await page.waitFor(role('link', 'Sign in to connect'));
      await page.click(role('link', 'Create an account'));
      await page.waitForUrl(/\/register\?/);
      const next = new URL(await page.url()).searchParams.get('next');
      assert(next === `/public/${tara.id}`, `sign-up should come back to the profile, not ${next}`);
      await page.waitFor(css('form'));
      await page.expectNoHorizontalScroll();
    });

    await step('A listing without photos says so, never showing a stock photo', async () => {
      await visit(page, url('/properties'));
      await page.waitFor(role('heading', fixtures.listings.over_budget.title));
      await page.waitFor(text('No photo yet'));
    });

    await step('Forgot password sends a reset link', async () => {
      await visit(page, url('/forgot-password'));
      await page.waitFor(role('heading', 'Reset your password'));
      await page.fill(label('Email'), tara.email);
      await page.click(role('button', 'Send reset link'));
      await page.waitFor(role('heading', 'Check your email'));
    });

    await step('The emailed link sets a new password', async () => {
      const outbox = await (await fetch(`${api}/e2e/outbox`)).json();
      const email = outbox.findLast((item) => item.to === tara.email);
      assert(email, 'no reset email reached the outbox');
      assert(email.link.startsWith(`${web}/reset-password#`), `the link goes to ${email.link.split('#')[0]}`);
      await page.open(email.link);
      await page.waitFor(role('heading', 'Choose a new password'));
      await page.fill(label('New password'), NEW_PASSWORD);
      await page.fill(label('Confirm new password'), NEW_PASSWORD);
      await page.click(role('button', 'Update password'));
      await page.waitForUrl('/login?reason=password-updated', { timeout: 30_000 });
      await page.waitForText('Password updated. Sign in with your new password.');
    });

    await step('The new password signs in', async () => {
      await signIn(page, web, { ...fixtures, password: NEW_PASSWORD }, 'tenant');
      await page.waitForUrl('/tenant/dashboard');
      await page.waitFor(role('heading', 'Welcome back, Tara!'));
    });
  },
};
