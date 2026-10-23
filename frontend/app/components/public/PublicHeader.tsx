import Link from 'next/link';
import BrandLogo from '@/app/components/BrandLogo';
import MobileNav, { type MobileNavItem } from '@/app/components/layout/MobileNav';
import ListMenu from '@/app/components/public/ListMenu';
import WithinPageLink from '@/app/components/public/WithinPageLink';
import { PROVIDER_MARKETPLACE_HREF, searchHref } from '@/app/lib/home-search';

const NAV: MobileNavItem[] = [
  { href: '/properties', label: 'Rentals' },
  // /search keeps its whole search in the URL on the client.
  { href: searchHref('profiles', ''), label: 'Find profiles', withinPage: true },
  { href: PROVIDER_MARKETPLACE_HREF, label: 'Find providers' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/rental-rights', label: 'Rental rights' },
];
// Below 360px the header has no room for "Sign in" (it overflowed 320px by
// 8px), so the menu offers it there instead.
const MENU = [...NAV, { href: '/login', label: 'Sign in' }];

export default function PublicHeader() {
  return (
    <header className="print:hidden sticky top-0 z-50 h-[76px] border-b border-[#efeff2] bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-4 xl:px-10">
        <div className="flex items-center gap-2">
          <MobileNav items={MENU} breakpointClass="xl:hidden">
            <ListMenu placement="panel" />
          </MobileNav>
          <div className="flex items-center gap-5">
          <BrandLogo size="md" />
          <nav className="hidden items-center gap-4 xl:flex">
            {NAV.map((item) => {
              const className = 'whitespace-nowrap text-sm font-medium text-[#5f6b76] transition-colors hover:text-[#1b1b1f]';
              return item.withinPage ? (
                <WithinPageLink key={item.label} href={item.href} className={className}>{item.label}</WithinPageLink>
              ) : (
                <Link key={item.label} href={item.href} className={className}>{item.label}</Link>
              );
            })}
          </nav>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/properties"
            aria-label="Search rentals"
            className="hidden size-[38px] items-center justify-center rounded-[10px] border border-[#efeff2] bg-white text-[#5f6b76] sm:inline-flex"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </Link>
          <Link
            href="/login"
            className="whitespace-nowrap text-sm font-semibold text-[#1b1b1f] transition-colors hover:text-primary-strong max-[360px]:hidden"
          >
            Sign in
          </Link>
          <ListMenu />
        </div>
      </div>
    </header>
  );
}
