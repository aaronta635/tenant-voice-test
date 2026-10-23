import Link from 'next/link';
import Card from '@/app/components/ui/Card';

export const metadata = { title: 'How it works' };

const TENANT_STEPS = [
  { title: 'Search with real information', body: 'Browse listings showing weekly rent, bond, availability and inspection times up front — plus verified reviews from people who actually lived there.' },
  { title: 'Book an inspection', body: 'Pick a published inspection time or message the landlord directly to arrange one.' },
  { title: 'Apply once, reuse everywhere', body: 'Submit your details, income and move-in date. Track every application status from your dashboard.' },
  { title: 'Review your tenancy', body: 'Once your tenancy is confirmed you can leave a verified review, helping the next tenant decide.' },
];

const OWNER_STEPS = [
  { title: 'List your property', body: 'A three-step wizard covers details, photos and rental terms. Publish when you are ready.' },
  { title: 'Review applications', body: 'Compare applicants side by side, shortlist the strong ones, and approve or decline.' },
  { title: 'Message applicants directly', body: 'Every application has a conversation attached, so questions never get lost in email.' },
  { title: 'Hire verified providers', body: 'Book inspectors, tradies, cleaners and agents with upfront prices from the marketplace.' },
];

const PROVIDER_STEPS = [
  { title: 'Build your profile', body: 'Add your business details, service area and credentials. Verified badges appear once our trust team approves your documents.' },
  { title: 'Set clear prices', body: 'List flat, hourly or starting prices with the service scope, so clients know what to expect before requesting a booking.' },
  { title: 'Manage bookings', body: 'Accept, schedule and complete jobs, then track earnings and invoices in one place.' },
];

function StepList({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <ol className="mt-5 space-y-4">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">
            {index + 1}
          </span>
          <div>
            <p className="font-bold text-text-dark">{step.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-text-body">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="mx-auto w-full max-w-[900px] px-6 py-12 lg:px-0">
      <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Getting started</p>
      <h1 className="mt-2 font-heading text-[34px] font-bold tracking-tight text-text-dark">
        How TenantVoice works
      </h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-text-body">
        TenantVoice brings transparency to the NSW rental market. Tenants see verified reviews
        before they apply, landlords manage their portfolio in one place, and service providers
        list upfront prices — all on the same platform.
      </p>

      <div className="mt-10 space-y-6">
        <Card className="rounded-[16px] border border-border p-7">
          <h2 className="font-heading text-2xl font-bold text-text-dark">If you&apos;re renting</h2>
          <StepList steps={TENANT_STEPS} />
          <Link href="/properties" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
            Browse rentals →
          </Link>
        </Card>

        <Card className="rounded-[16px] border border-border p-7">
          <h2 className="font-heading text-2xl font-bold text-text-dark">If you&apos;re a landlord</h2>
          <StepList steps={OWNER_STEPS} />
          <Link href="/register?role=landlord" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
            Create a landlord account →
          </Link>
        </Card>

        <Card className="rounded-[16px] border border-border p-7">
          <h2 className="font-heading text-2xl font-bold text-text-dark">
            If you provide a service
          </h2>
          <StepList steps={PROVIDER_STEPS} />
          <Link href="/register?role=service_provider" className="mt-6 inline-block text-sm font-semibold text-primary hover:underline">
            List your service →
          </Link>
        </Card>
      </div>
    </div>
  );
}
