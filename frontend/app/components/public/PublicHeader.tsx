import Link from 'next/link';
import BrandLogo from '@/app/components/BrandLogo';

const NAV = [
  { href: '/categories/co-host-inspector', label: 'Find providers' },
  { href: '/#categories', label: 'Categories' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/register', label: 'For providers' },
  { href: '/#resources', label: 'Resources' },
];

export default function PublicHeader() {
  return (
    <header className="sticky top-0 z-50 h-[76px] border-b border-[#efeff2] bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-6 lg:px-14">
        <div className="flex items-center gap-8">
          <BrandLogo size="md" />
          <nav className="hidden items-center gap-6 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="text-sm font-medium text-[#5f6b76] transition-colors hover:text-[#1b1b1f]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Search"
            className="hidden size-[38px] items-center justify-center rounded-[10px] border border-[#efeff2] bg-white text-[#5f6b76] sm:inline-flex"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </button>
          <Link
            href="/login"
            className="text-sm font-semibold text-[#1b1b1f] transition-colors hover:text-primary"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="inline-flex h-[37px] items-center rounded-full bg-primary px-5 text-sm font-bold text-white shadow-[0_1px_1px_rgba(99,106,232,0.25)] transition-colors hover:bg-[#5258d4]"
          >
            List your service
          </Link>
        </div>
      </div>
    </header>
  );
}
