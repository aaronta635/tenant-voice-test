import Link from 'next/link';
import Card from '@/app/components/ui/Card';

export const metadata = { title: 'Rental rights' };

const FAIR_TRADING = 'https://www.fairtrading.nsw.gov.au/housing-and-property/renting';

/**
 * Deliberately general. We describe what each right covers and always send the
 * reader to NSW Fair Trading for the binding detail — notice periods and caps
 * change with legislation and must not be hard-coded into a marketing page.
 */
const TOPICS = [
  {
    title: 'Bond',
    body: 'Your bond is your money, held by NSW Fair Trading — not by the landlord or their agent. It is lodged through Rental Bonds Online, and NSW law caps it at four weeks’ rent for most residential tenancies. At the end of a tenancy it must be returned unless the landlord can justify a claim.',
  },
  {
    title: 'Rent increases',
    body: 'Rent cannot be raised whenever the landlord feels like it. Written notice is required, minimum notice periods apply, and there are limits on how often an increase can occur. If you believe an increase is excessive you can challenge it at NCAT.',
  },
  {
    title: 'Entry and privacy',
    body: 'The property is your home. A landlord or agent must give proper notice before entering, and entry is only permitted for specific reasons such as inspections, repairs or showing the property. There are limits on how many routine inspections can occur each year.',
  },
  {
    title: 'Repairs and maintenance',
    body: 'The landlord must keep the property in a reasonable state of repair. Urgent repairs — things like a burst pipe, a serious electrical fault, or a failed essential service — have a faster process, and in some cases you can arrange the repair yourself and be reimbursed.',
  },
  {
    title: 'Ending a tenancy',
    body: 'Both sides must follow the correct process and give the required written notice. A landlord cannot simply remove you without following the law, and only NCAT or the Sheriff can enforce an eviction — never the landlord directly.',
  },
  {
    title: 'Resolving disputes',
    body: 'Most disputes can be raised with NSW Fair Trading first, which offers a free complaint and mediation service. If it cannot be resolved, either party can apply to the NSW Civil and Administrative Tribunal (NCAT) for a binding decision.',
  },
];

export default function RentalRightsPage() {
  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-12 lg:px-0">
      <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Know your rights</p>
      <h1 className="mt-2 font-heading text-[34px] font-bold tracking-tight text-text-dark">
        Renting in NSW
      </h1>
      <p className="mt-3 leading-relaxed text-text-body">
        A plain-English overview of the protections every NSW renter has under the{' '}
        <em>Residential Tenancies Act 2010</em>. Understanding these makes it much easier to
        raise a problem early — and to know when something has gone genuinely wrong.
      </p>

      <div
        role="note"
        className="mt-6 rounded-[14px] border border-[#f3d9a4] bg-[#fdf6e7] p-5 text-sm leading-relaxed text-[#7a5b16]"
      >
        <strong className="font-bold">General information only.</strong> This page is not legal
        advice, and tenancy law changes. For the current rules — including exact notice periods,
        caps and timeframes — always check{' '}
        <a
          href={FAIR_TRADING}
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline"
        >
          NSW Fair Trading
        </a>
        , or get advice from your local Tenants&apos; Advice and Advocacy Service.
      </div>

      <div className="mt-10 space-y-4">
        {TOPICS.map((topic) => (
          <Card key={topic.title} className="rounded-[16px] border border-border p-6">
            <h2 className="font-heading text-xl font-bold text-text-dark">{topic.title}</h2>
            <p className="mt-2 leading-relaxed text-text-body">{topic.body}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-10 rounded-[16px] border border-border bg-surface p-6">
        <h2 className="font-heading text-lg font-bold text-text-dark">
          Something gone wrong in your tenancy?
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-text-body">
          If you rent through TenantVoice you can raise a formal complaint against a property or
          landlord. Complaints are tracked to resolution and help surface repeat problems.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/tenant/complaints"
            className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-white hover:bg-[#5258d4]"
          >
            Lodge a complaint
          </Link>
          <a
            href={FAIR_TRADING}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center rounded-full border border-border px-6 text-sm font-bold text-text-dark hover:border-primary hover:text-primary"
          >
            NSW Fair Trading
          </a>
        </div>
      </Card>
    </div>
  );
}
