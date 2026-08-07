import Link from 'next/link';
import BrandLogo from '@/app/components/BrandLogo';

export default function PublicFooter() {
  return (
    <footer className="border-t border-[#efeff2] bg-white">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-6 py-12 lg:flex-row lg:justify-between lg:px-14">
        <div className="max-w-sm">
          <BrandLogo href="/" size="md" />
          <p className="mt-3 text-sm leading-relaxed text-[#5f6b76]">
            Verified property services with fixed prices — inspectors, agents, tradies and
            accountants across Australia.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          <div>
            <p className="text-xs font-bold tracking-wider text-[#8c97a2] uppercase">Explore</p>
            <ul className="mt-3 space-y-2 text-sm text-[#5f6b76]">
              <li>
                <Link href="/categories/co-host-inspector" className="hover:text-[#1b1b1f]">
                  Find providers
                </Link>
              </li>
              <li>
                <Link href="/#categories" className="hover:text-[#1b1b1f]">
                  Categories
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold tracking-wider text-[#8c97a2] uppercase">Providers</p>
            <ul className="mt-3 space-y-2 text-sm text-[#5f6b76]">
              <li>
                <Link href="/register" className="hover:text-[#1b1b1f]">
                  List your service
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-[#1b1b1f]">
                  Provider sign in
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold tracking-wider text-[#8c97a2] uppercase">Legal</p>
            <ul className="mt-3 space-y-2 text-sm text-[#5f6b76]">
              <li>Privacy</li>
              <li>Terms</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="border-t border-[#efeff2] py-4 text-center text-sm text-[#8c97a2]">
        © 2026 TenantVoice. All rights reserved.
      </div>
    </footer>
  );
}
