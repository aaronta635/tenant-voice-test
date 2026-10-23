import Link from 'next/link';
import { getSessionRole } from '@/app/lib/session-role';
import DemoLabel from '@/app/components/demo/DemoLabel';
import Card from '@/app/components/ui/Card';
import { api, safe, type SupportContact } from '@/app/lib/api';
import { sampleContactReason } from '@/app/lib/demo';

export const metadata = { title: 'Contact us' };

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ topic?: string; provider?: string }> }) {
  const { topic, provider } = await searchParams;
  const role = await getSessionRole();
  const reporting = topic === 'report-profile' && !!provider;
  // Only tenants can lodge a tracked complaint; the landlord and provider
  // complaint pages list complaints made about that account.
  const againstMeHref = role === 'Owner' ? '/owner/complaints' : role === 'Provider' ? '/dashboard/complaints' : null;
  // Support details live in public.platform_settings, not in code.
  const contact = await safe<SupportContact | null>(api.content.supportContact(), null);
  const sampleReason = sampleContactReason(contact);

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-12 lg:px-0">
      <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Support</p>
      <h1 className="mt-2 font-heading text-[34px] font-bold tracking-tight text-text-dark">
        Contact TenantVoice
      </h1>
      <p className="mt-3 leading-relaxed text-text-body">
        Our team is available Monday to Friday, 9am–6pm AEST, and answers within one business day.
      </p>

      {reporting ? <Card className="mt-6 rounded-2xl border border-border p-6">
        <h2 className="font-heading text-xl font-bold">Report a provider profile</h2>
        <p className="mt-2 text-sm text-text-body">Profile: <span className="font-semibold break-all">{provider}</span></p>
        <p className="mt-2 text-sm text-text-body">Include what happened, relevant dates, and any booking reference. Your email app will open a draft; review it before sending.</p>
        {contact?.email ? <a className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary-strong underline" href={`mailto:${contact.email}?subject=${encodeURIComponent(`Report provider profile: ${provider}`)}&body=${encodeURIComponent(`Provider: ${provider}\n\nWhat happened:\n\nDate and booking reference:\n`)}`}>Email this profile report</a> : <p className="mt-3 text-sm text-danger">Support email is currently unavailable. Please try again later.</p>}
      </Card> : null}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card className="rounded-[16px] border border-border p-6">
          <p className="text-xs font-bold tracking-wider text-text-subtle uppercase">Email</p>
          {contact?.email ? (
            <a
              href={`mailto:${contact.email}`}
              className="mt-2 block font-heading text-lg font-bold break-all text-primary hover:underline"
            >
              {contact.email}
            </a>
          ) : (
            <p className="mt-2 text-text-body">Unavailable right now.</p>
          )}
          <p className="mt-2 text-sm text-text-body">Best for account, billing and listing questions.</p>
        </Card>

        <Card className="rounded-[16px] border border-border p-6">
          <p className="text-xs font-bold tracking-wider text-text-subtle uppercase">Phone</p>
          {contact?.phone ? (
            <a
              href={`tel:${contact.phone.replace(/\s/g, '')}`}
              className="mt-2 block font-heading text-lg font-bold text-primary hover:underline"
            >
              {contact.phone}
            </a>
          ) : (
            <p className="mt-2 text-text-body">Unavailable right now.</p>
          )}
          <p className="mt-2 text-sm text-text-body">Best for urgent tenancy or safety matters.</p>
        </Card>
      </div>
      {sampleReason ? <DemoLabel variant="notice" className="mt-4" reason={sampleReason} /> : null}

      <Card className="mt-6 rounded-[16px] border border-border p-6">
        <h2 className="font-heading text-lg font-bold text-text-dark">Before you get in touch</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-text-body">
          <li>
            •{' '}
            <Link href="/faqs" className="font-semibold text-primary hover:underline">
              Check the FAQs
            </Link>{' '}
            — most account and listing questions are answered there.
          </li>
          <li>
            • Already signed in? Message a landlord or provider directly from your inbox rather than
            emailing support.
          </li>
          {role === 'Client' ? (
            <li>• To raise a formal issue, <Link href="/tenant/complaints" className="font-semibold text-primary-strong underline">lodge a tracked complaint</Link> from your complaints page.</li>
          ) : againstMeHref ? (
            <li>• To raise a formal issue, <SupportEmail email={contact?.email} />. <Link href={againstMeHref} className="font-semibold text-primary-strong underline">Complaints about you</Link> are listed in your workspace.</li>
          ) : (
            <li>• Renting? <Link href={`/login?role=tenant&next=${encodeURIComponent('/tenant/complaints')}`} className="font-semibold text-primary-strong underline">Sign in as a tenant to lodge a tracked complaint</Link>. Landlords and service providers raising a formal issue can <SupportEmail email={contact?.email} />.</li>
          )}
        </ul>
      </Card>

      <p className="mt-8 text-sm leading-relaxed text-text-body">
        TenantVoice is a marketplace, not a government body. For matters that fall under NSW
        tenancy law, contact{' '}
        <a
          href="https://www.fairtrading.nsw.gov.au/housing-and-property/renting"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-primary hover:underline"
        >
          NSW Fair Trading
        </a>
        .
      </p>
    </div>
  );
}

function SupportEmail({ email }: { email?: string }) {
  if (!email) return 'use the support contact details above when available';
  return <a href={`mailto:${email}`} className="font-semibold text-primary-strong underline">email support with the relevant property or booking details</a>;
}
