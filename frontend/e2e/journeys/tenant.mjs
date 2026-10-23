// A verified tenant (R14, R15, R24, R25, R34, R05, R31, R43, R37): sign in,
// save preferences, see matches with their reasons and the providers near
// them, open a property and apply with the form the profile fills, find the
// application in the list, message the landlord, upload a document, ask the
// landlord to connect, ask an agent for a scorecard and ask the support chat.
import { label, role, text } from '../driver.mjs';
import { assert, demoPdf, signIn, visit } from './support.mjs';

export const tenant = {
  name: 'tenant',
  title: 'Tenant',
  workspace: 'Client',
  routes: ['/login', '/tenant/dashboard', '/tenant/rental-preferences', '/tenant/recommendations',
    '/tenant/properties/00000000-0000-4000-8000-000000000000', '/tenant/applications', '/tenant/messages',
    '/tenant/id-verification', '/public/00000000-0000-4000-8000-000000000000', '/tenant/help-support'],
  async run({ page, step, fixtures, url, web, out }) {
    const lena = fixtures.accounts.landlord;
    const home = fixtures.listings.newtown;

    await step('Sign in as a tenant', async () => {
      await signIn(page, web, fixtures, 'tenant');
      await page.waitForUrl('/tenant/dashboard');
      await page.waitFor(role('heading', 'Welcome back, Tara!'));
      await page.expectNoHorizontalScroll();
    });

    await step('Save rental preferences', async () => {
      await visit(page, url('/tenant/rental-preferences'));
      const budget = label('Maximum weekly budget ($)');
      assert(await page.value(budget) === '750', `the saved maximum reads ${await page.value(budget)}`);
      await page.fill(budget, '800');
      await page.click(role('button', 'Save preferences'));
      await page.waitForText('Saved to your account.');
      await page.open(url('/tenant/rental-preferences'));
      assert(await page.value(budget) === '800', `after a reload the maximum reads ${await page.value(budget)}`);
    });

    await step('Matches come with the reasons they fit', async () => {
      await visit(page, url('/tenant/recommendations'));
      const homes = role('region', 'Homes that match your preferences');
      await page.waitFor(role('heading', home.title, { within: homes }));
      await page.waitFor(text('within your $800 budget', { within: homes }));
      await page.waitFor(text('one of your preferred', { within: homes }));
      // It fits every other must (Newtown, an apartment, free before the move-in), so only the budget leaves it out.
      assert(!(await page.exists(role('heading', fixtures.listings.over_budget.title, { within: homes }))),
        'a home over the budget is matched');
      assert(!(await page.exists(role('heading', fixtures.listings.marrickville.title, { within: homes }))),
        'a home elsewhere and over the budget is matched');
      // The providers ranked for where she lives and would like to (R31).
      const providers = role('region', 'Service providers near you');
      await page.waitFor(role('heading', /Okafor Plumbing/, { within: providers }));
      await page.waitFor(text('Based in Newtown', { within: providers }));
    });

    await step('Open a matched property', async () => {
      await page.click(role('link', `View home: ${home.title}`));
      await page.waitForUrl(`/tenant/properties/${home.id}`);
      await page.waitFor(role('heading', home.title, { level: 1 }));
      await page.waitFor(role('button', 'Show photo 2 of 2'));
      await page.waitFor(text('$680'));
      await page.expectNoHorizontalScroll();
    });

    await step('Apply with the form the profile fills', async () => {
      await page.click(role('button', 'Apply for this property'));
      const form = role('dialog', `Apply for ${home.title}`);
      await page.waitFor(label('People living there', { within: form }));
      // The profile fills the move-in date, the household and the about line; the offer is the asking
      // rent, within the budget. The income stays the tenant's to share: the form never copies it.
      assert(await page.value(label('Move-in date', { within: form })), 'the move-in date is not filled in');
      assert(await page.value(label('People living there', { within: form })) === '2', 'the household size is not filled in');
      assert(await page.value(label('Weekly rent you offer ($)', { within: form })) === '680', 'the offer is not the asking rent');
      assert((await page.value(label('About you', { within: form }))).startsWith('Quiet professional'), 'the about line is not filled in');
      assert(await page.value(label('Yearly income ($, optional)', { within: form })) === '', 'the private income was copied in');
      await page.fill(label('Yearly income ($, optional)', { within: form }), '92000');
      await page.fill(label('Message to the landlord (optional)', { within: form }), 'Could I inspect on Saturday morning?');
      await page.click(role('button', 'Send application', { within: form }));
      await page.waitForText('Application sent. The landlord will see it with the listing.');
      // The answer takes the focus, so a screen reader reads it out.
      const focus = await page.focused();
      assert(focus?.name.includes('Application sent'), `focus is on ${JSON.stringify(focus)}, not the answer`);
      await page.waitFor(role('link', 'View my applications'));
    });

    await step('The application is in my list', async () => {
      await visit(page, url('/tenant/applications'));
      await page.waitFor(role('heading', home.title));
      await page.waitFor(role('heading', fixtures.listings.glebe.title));
    });

    await step('Message the landlord', async () => {
      await visit(page, url('/tenant/messages'));
      await page.click(role('button', /Lena Park/));
      const thread = role('log', `Messages with ${lena.full_name}`);
      await page.waitFor(text('Saturday at 10am works', { within: thread }));
      await page.fill(label('Message'), 'Thanks Lena, see you on Saturday at 10am.');
      await page.click(role('button', 'Send'));
      await page.waitFor(text('Thanks Lena, see you on Saturday at 10am.', { within: thread }));
      await page.expectNoHorizontalScroll();
    });

    await step('Upload a document', async () => {
      await visit(page, url('/tenant/id-verification'));
      const card = role('group', 'Bank statement');
      await page.waitFor(text('Not uploaded', { within: card }));
      await page.upload(label('File for Bank statement'), await demoPdf(out, 'bank-statement.pdf', 'Bank statement'));
      await page.waitFor(role('button', 'View Bank statement'));
      await page.waitForGone(text('Not uploaded', { within: card }));
    });

    await step('Ask the landlord to connect', async () => {
      await visit(page, url(`/public/${lena.id}`));
      await page.click(role('button', `Connect with ${lena.full_name}`));
      await page.waitForText('Pending: request sent');
      await page.waitFor(role('button', `Withdraw your request to ${lena.full_name}`));
    });

    await step("Ask the studio's agent for a scorecard", async () => {
      await visit(page, url('/tenant/dashboard'));
      const card = role('region', 'Scorecards');
      // Tara asked Lena already (the dataset), and the agent who manages the studio can be asked too.
      await page.waitFor(text(`Waiting for ${lena.full_name} to complete it.`, { within: card }));
      await page.click(role('button', 'Request scorecard', { within: card }));
      const form = role('form', 'Request a scorecard');
      await page.waitFor(text('Already asked: waiting for their answer', { within: form }));
      await page.click(role('radio', new RegExp(fixtures.accounts.agent.full_name), { within: form }));
      await page.click(role('button', 'Send request', { within: form }));
      await page.waitForText(`Request sent to ${fixtures.accounts.agent.full_name}. You will be told when they answer.`);
    });

    await step('The support chat answers from the help pages', async () => {
      await visit(page, url('/tenant/help-support'));
      const chat = role('region', 'Support chat');
      await page.fill(label('Your question', { within: chat }), 'How do I get verified?');
      await page.click(role('button', 'Send', { within: chat }));
      // No model is configured here, so the help pages answer, and say so (R37).
      await page.waitFor(text('AI answers are unavailable right now', { within: chat }));
      await page.waitFor(role('link', 'How tenants get verified', { within: chat }));
    });
  },
};
