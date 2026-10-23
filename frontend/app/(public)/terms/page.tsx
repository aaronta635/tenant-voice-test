import Link from 'next/link';

export const metadata = { title: 'Terms of Use' };

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-12">
      <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Legal</p>
      <h1 className="mt-2 font-heading text-[34px] font-bold tracking-tight text-text-dark">
        Terms of Use
      </h1>
      <p className="mt-3 leading-relaxed text-text-body">
        TenantVoice is a rental transparency platform for tenants, landlords, and service providers.
        By creating an account you agree to provide accurate information, keep your login details
        confidential, and use the service only for lawful residential-rental activity in NSW.
      </p>
      <p className="mt-4 leading-relaxed text-text-body">
        Listings, applications, reviews, and messages are user-generated. TenantVoice does not
        become a party to any lease. Payments in the current product are mocked and do not process
        real funds. Questions about these terms can be sent from the{' '}
        <Link href="/contact" className="font-semibold text-primary hover:underline">
          contact page
        </Link>
        .
      </p>
    </div>
  );
}
