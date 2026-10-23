import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import type { OnboardingRole } from '@/app/lib/onboarding';

type Row = { title: string; body: string; link?: { href: string; label: string } };

const ROWS: Record<OnboardingRole, Row[]> = {
  tenant: [
    {
      title: 'What owners can see',
      body: 'Your public profile shows your first name and initial, the suburbs you want, your budget, move-in month, rating and about line. Documents never show, only whether you are verified.',
    },
    {
      title: 'Your documents',
      body: 'You and TenantVoice admins can open them, through a link that works for 5 minutes. In the TenantVoice app, the owner of a listing you have an open or approved application for can open them too.',
    },
    {
      title: 'Privacy settings',
      body: 'Choose whether your profile shows in profile search.',
      link: { href: '/tenant/settings', label: 'Open your settings' },
    },
    {
      title: 'What TenantVoice keeps',
      body: 'The privacy policy says what TenantVoice keeps about you and why.',
      link: { href: '/privacy', label: 'Read the privacy policy' },
    },
    {
      title: 'Need help?',
      body: 'Contact our support team if you get stuck on a section or an upload.',
      link: { href: '/tenant/help-support', label: 'Get help' },
    },
  ],
  landlord: [
    {
      title: 'What tenants can see',
      body: 'Your public profile shows your name, business name, suburb, rating and about line. Your licence number and documents never show, only whether you are verified.',
    },
    {
      title: 'Your documents',
      body: 'Only you and TenantVoice admins can open them, through a link that works for 5 minutes.',
    },
    {
      title: 'Privacy settings',
      body: 'Choose whether your profile shows in profile search.',
      link: { href: '/owner/profile/settings', label: 'Open your settings' },
    },
    {
      title: 'What TenantVoice keeps',
      body: 'The privacy policy says what TenantVoice keeps about you and why.',
      link: { href: '/privacy', label: 'Read the privacy policy' },
    },
    {
      title: 'Need help?',
      body: 'Contact our support team if you get stuck on a section or an upload.',
      link: { href: '/owner/help', label: 'Get help' },
    },
  ],
};

/** The side card of the completion pages (reference: "How your information is used"). */
export default function InformationUse({ role }: { role: OnboardingRole }) {
  return (
    <Card className="overflow-hidden p-0">
      <h2 className="border-b border-border bg-surface px-5 py-4 font-heading text-base font-semibold text-text-dark">
        How your information is used
      </h2>
      <ul className="divide-y divide-border">
        {ROWS[role].map((row) => (
          <li key={row.title} className="px-5 py-4">
            <p className="text-sm font-semibold text-text-dark">{row.title}</p>
            <p className="mt-1 text-sm text-text-body">{row.body}</p>
            {row.link ? (
              <Link href={row.link.href} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary-strong underline">
                {row.link.label}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
