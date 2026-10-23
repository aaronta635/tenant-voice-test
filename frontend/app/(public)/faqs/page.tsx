import Link from 'next/link';
import MemberSupportChat from '@/app/components/support/MemberSupportChat';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import Card from '@/app/components/ui/Card';
import { api, type Faq } from '@/app/lib/api';

export const metadata = { title: 'FAQs' };

// FAQs are content, not code — they live in public.faqs and are edited there.
const AUDIENCE_LABELS: Record<string, string> = {
  all: 'General',
  tenant: 'For tenants',
  landlord: 'For landlords',
  service_provider: 'For service providers',
};

const AUDIENCE_ORDER = ['all', 'tenant', 'landlord', 'service_provider'];

export default async function FaqsPage() {
  let faqs: Faq[];
  try { faqs = await api.content.faqs(); }
  catch {
    return <div className="mx-auto w-full max-w-[820px] px-6 py-12"><h1 className="font-heading text-3xl font-bold text-text-dark">Frequently asked questions</h1><LoadErrorCard title="Could not load help topics" message="Please try again, or open Contact support for assistance." /><Link href="/contact" className="mt-5 inline-flex min-h-11 items-center font-semibold text-primary-strong underline">Contact support</Link><MemberSupportChat className="mt-8" /></div>;
  }

  const grouped = AUDIENCE_ORDER.map((audience) => ({
    audience,
    items: faqs
      .filter((f) => f.audience === audience)
      .sort((a, b) => a.sort_order - b.sort_order),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-12 lg:px-0">
      <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Help</p>
      <h1 className="mt-2 font-heading text-[34px] font-bold tracking-tight text-text-dark">
        Frequently asked questions
      </h1>

      {/* The provider workspace's help page: signed-in members can ask the support chat here. */}
      <MemberSupportChat className="mt-8" />

      {grouped.length === 0 ? (
        <Card className="mt-8 rounded-[16px] border border-border p-8 text-center">
          <p className="text-text-body">
            No questions published yet. Try our{' '}
            <Link href="/contact" className="font-semibold text-primary hover:underline">
              contact page
            </Link>
            .
          </p>
        </Card>
      ) : (
        grouped.map((group) => (
          <section key={group.audience} className="mt-10">
            <h2 className="font-heading text-xl font-bold text-text-dark">
              {AUDIENCE_LABELS[group.audience] ?? group.audience}
            </h2>
            <div className="mt-4 space-y-3">
              {group.items.map((faq) => (
                <details
                  key={faq.id}
                  className="group rounded-[14px] border border-border bg-white p-5 open:shadow-sm"
                >
                  <summary className="cursor-pointer list-none font-semibold text-text-dark marker:hidden">
                    <span className="flex items-start justify-between gap-4">
                      {faq.question}
                      <span className="mt-0.5 shrink-0 text-text-subtle transition-transform group-open:rotate-180">
                        ▾
                      </span>
                    </span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-text-body">{faq.answer}</p>
                </details>
              ))}
            </div>
          </section>
        ))
      )}

      <Card className="mt-12 rounded-[16px] border border-border bg-surface p-6">
        <h2 className="font-heading text-lg font-bold text-text-dark">Still need help?</h2>
        <p className="mt-1 text-sm text-text-body">
          Our support team answers within one business day.
        </p>
        <Link
          href="/contact"
          className="mt-4 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-white hover:bg-[#5258d4]"
        >
          Contact support
        </Link>
      </Card>
    </div>
  );
}
