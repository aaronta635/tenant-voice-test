import { cleanup, getByName, render, textOf } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountStanding } from '@/app/lib/account-standing';
import AccountStandingBanner from './AccountStandingBanner';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

afterEach(cleanup);

const banner = (state: AccountStanding | null) => render(<div className="bg-white"><AccountStandingBanner state={state} /></div>);

describe('AccountStandingBanner', () => {
  it('tells a suspended provider what they keep and what the gates refuse, and how to reach support', async () => {
    const view = await banner('suspended');

    const [section] = view.querySelectorAll('section');
    expect(section.getAttribute('aria-labelledby')).toBe('account-standing-title');
    // A named region above the page's own heading, not a heading that would come before it.
    expect(textOf(getByName(view, 'p', 'Your account is suspended'))).toBe('Your account is suspended');
    expect(getByName(view, 'p', 'Your account is suspended').id).toBe('account-standing-title');
    expect(view.querySelectorAll('h1').concat(view.querySelectorAll('h2'))).toEqual([]);
    const text = textOf(view);
    expect(text).toContain('You can finish the jobs in progress');
    expect(text).toContain('read your past bookings, messages and invoices');
    expect(text).toContain("you can't confirm or start bookings, take on repairs or go live");
    expect(text).toContain('message only the people of a job in progress');
    expect(getByName(view, 'a', 'Contact TenantVoice support').getAttribute('href')).toBe('/contact');
  });

  it('names an account that is not active as such', async () => {
    const view = await banner('inactive');

    expect(textOf(getByName(view, 'p', "Your account isn't active"))).toBe("Your account isn't active");
  });

  it.each<AccountStanding | null>(['approved', 'pending', 'rejected', 'unknown', null])(
    'shows nothing while the account itself is not what keeps work away (%s)',
    async (state) => {
      const view = await banner(state);

      expect(view.querySelectorAll('section')).toEqual([]);
    },
  );

  it('keeps its text and link at AA contrast', async () => {
    expect(lowContrastText(await banner('suspended'))).toEqual([]);
  });
});
