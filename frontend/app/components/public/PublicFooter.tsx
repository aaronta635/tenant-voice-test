import Link from 'next/link';
import BrandLogo from '@/app/components/BrandLogo';
import WithinPageLink from '@/app/components/public/WithinPageLink';
import { PROVIDER_MARKETPLACE_HREF, searchHref } from '@/app/lib/home-search';
import { LIST_OPTIONS, listOptionSignUpHref } from '@/app/lib/list-options';

const [listService, listProperty] = LIST_OPTIONS;

// The public layout shows this footer only to visitors without a session, so
// the listing links sign up for the account type and land on the form. Every
// link opens a page the app has; the reference's links to pages that do not
// exist yet, social accounts and app stores are left out.
const COLUMNS: { title: string; links: { href: string; label: string; withinPage?: boolean }[] }[] = [
  {
    title: 'For tenants',
    links: [
      { href: '/properties', label: 'Find a rental' },
      { href: '/register?role=tenant', label: 'Create a tenant account' },
      { href: '/login?role=tenant', label: 'Tenant sign in' },
    ],
  },
  {
    title: 'For landlords',
    links: [
      { href: listOptionSignUpHref(listProperty), label: listProperty.label },
      // /search reads its query on the client, so on /search this opens through the History API.
      { href: searchHref('profiles', '', 'tenant'), label: 'Find tenants', withinPage: true },
      { href: '/register?role=landlord', label: 'Create a landlord account' },
      { href: '/login?role=landlord', label: 'Landlord sign in' },
    ],
  },
  {
    title: 'For service providers',
    links: [
      { href: listOptionSignUpHref(listService), label: listService.label },
      { href: PROVIDER_MARKETPLACE_HREF, label: 'Browse categories' },
      { href: '/login?role=service_provider', label: 'Provider sign in' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/how-it-works', label: 'How it works' },
      { href: '/contact', label: 'Contact us' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms of use' },
      { href: '/privacy', label: 'Privacy policy' },
    ],
  },
  {
    title: 'Support',
    links: [
      { href: '/faqs', label: 'FAQs' },
      { href: '/rental-rights', label: 'Rental rights' },
    ],
  },
];

export default function PublicFooter() {
  return (
    <footer data-surface="dark" className="print:hidden bg-navy text-white">
      <div className="mx-auto max-w-[1440px] px-6 pt-14 pb-8 lg:px-14">
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-6">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm font-semibold text-surface">{column.title}</h2>
              <ul className="mt-4 space-y-3 text-sm">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.withinPage ? (
                      <WithinPageLink href={link.href} className="text-white hover:underline">{link.label}</WithinPageLink>
                    ) : (
                      <Link href={link.href} className="text-white hover:underline">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/15 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex w-fit rounded-xl bg-white px-3 py-2">
            <BrandLogo href="/" size="sm" />
          </span>
          <p className="text-sm text-surface">© {new Date().getFullYear()} TenantVoice. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
