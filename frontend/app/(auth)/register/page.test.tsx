import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { componentNamed, find, mount, textOf } from '@/app/test-utils/shallow-render';
import { LIST_OPTIONS, listOptionHref } from '@/app/lib/list-options';
import RegisterPage from './page';

// Not in auth-pages.test.tsx: the shallow renderer's hooks replace React's for
// the whole file, and the link tests there need React's to server-render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  ...(await import('@/app/test-utils/shallow-render')).fakeHooks,
}));

const nav = vi.hoisted(() => ({ search: '', router: { push: vi.fn(), refresh: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock('@/app/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/api')>()),
  setAuthSession: () => {},
  api: {
    auth: {
      // The new account holds the role the form asked for.
      register: async ({ role }: { role: string }) => ({ access_token: 'access', refresh_token: 'refresh', profile: { role } }),
    },
  },
}));

const bookingPath = '/providers/amelia?service=svc-1&slot=2026-10-27%7C10%3A00%3A00&suburb=Newtown#booking';

const type = (tree: ReactNode, id: string, value: string) => (find(tree, (element) => element.props.id === id).props.onChange as (value: string) => void)(value);

/** Sign up through the form on /register?`search` and return where it sends the new account. */
async function signUp(search: string) {
  nav.search = search;
  nav.router.push.mockClear();
  const element = find(RegisterPage(), componentNamed('RegisterForm'));
  const form = mount(element.type as () => ReactNode, {});
  const fields = form.render();
  type(fields, 'reg-name', 'Amelia Whitlock');
  type(fields, 'reg-email', 'amelia@example.com');
  type(fields, 'reg-password', 'correct-horse');
  const submit = find(form.render(), (element) => element.type === 'form').props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>;
  await submit({ preventDefault: () => {} });
  return nav.router.push.mock.calls.at(-1)?.[0];
}

describe('after a successful sign-up', () => {
  it('returns a guest to the booking they started, not the tenant dashboard', async () => {
    expect(await signUp(`role=tenant&next=${encodeURIComponent(bookingPath)}`)).toBe(bookingPath);
  });

  it.each([
    ['service_provider', '/dashboard/onboarding'],
    ['landlord', '/owner/onboarding'],
    ['tenant', '/tenant/onboarding'],
  ])('sends a new %s with no return path to their onboarding', async (role, onboarding) => {
    expect(await signUp(`role=${role}`)).toBe(onboarding);
  });
});

describe('signing up from the header\'s "List" menu', () => {
  const [service, property] = LIST_OPTIONS;
  /** The query of the sign-up link the menu gives a visitor. */
  const linkQuery = (option: typeof service) => (listOptionHref(option, null) as string).split('?')[1];

  it('says a new landlord goes on to set up their profile, which is where they land', async () => {
    nav.search = 'role=landlord';
    const element = find(RegisterPage(), componentNamed('RegisterForm'));
    const submit = find(mount(element.type as () => ReactNode, {}).render(), (node) => node.type === 'button'
      && node.props.type === 'submit');

    expect(textOf(submit)).toBe('Continue to set up your profile');
    expect(await signUp('role=landlord')).toBe('/owner/onboarding');
  });

  it('takes a new landlord through onboarding, which carries the listing form', async () => {
    const landing = new URL(await signUp(linkQuery(property)), 'https://tenantvoice.test');
    expect(landing.pathname).toBe('/owner/onboarding');
    expect(landing.searchParams.get('next')).toBe('/owner/properties/create');
  });

  it('takes a new provider through onboarding, which carries the new-service form', async () => {
    const landing = new URL(await signUp(linkQuery(service)), 'https://tenantvoice.test');
    expect(landing.pathname).toBe('/dashboard/onboarding');
    expect(landing.searchParams.get('next')).toBe('/dashboard/services?new=1');
  });

  it('keeps the account type and the form on the link to sign in instead', () => {
    nav.search = linkQuery(property);
    const form = mount(find(RegisterPage(), componentNamed('RegisterForm')).type as () => ReactNode, {});
    const signIn = find(form.render(), (element) => textOf(element).trim() === 'Sign in' && typeof element.props.href === 'string');
    expect(signIn.props.href).toBe(`/login?${linkQuery(property)}`);
  });
});
