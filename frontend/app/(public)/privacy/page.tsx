import Link from 'next/link';

export const metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-12">
      <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Legal</p>
      <h1 className="mt-2 font-heading text-[34px] font-bold tracking-tight text-text-dark">
        Privacy Policy
      </h1>
      <p className="mt-3 leading-relaxed text-text-body">
        TenantVoice collects the account, profile, listing, and application information you submit
        so we can operate the marketplace. We do not sell personal information. Verification
        documents are used only to assess identity and credentials.
      </p>
      <p className="mt-4 leading-relaxed text-text-body">
        You can update contact details from your workspace, or ask us to correct or delete account
        data by contacting support. For questions about this policy, use the{' '}
        <Link href="/contact" className="font-semibold text-primary hover:underline">
          contact page
        </Link>
        .
      </p>
    </div>
  );
}
