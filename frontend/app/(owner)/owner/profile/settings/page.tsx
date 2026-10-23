'use client';

import Link from 'next/link';
import ProfileSettingsForm from '@/app/components/profile/ProfileSettingsForm';
import Card from '@/app/components/ui/Card';
import LoadErrorCard from '@/app/components/ui/LoadErrorCard';
import { useMyProfile } from '@/app/lib/use-my-profile';

const LINKS = [
  { href: '/owner/notifications', title: 'Notifications', description: 'Read your account alerts.' },
  { href: '/owner/subscription', title: 'Subscription', description: 'Manage plan, billing, and renewals.' },
  { href: '/privacy', title: 'Privacy', description: 'How TenantVoice handles your information.' },
  { href: '/terms', title: 'Terms', description: 'Platform terms of use.' },
];

export default function OwnerAccountSettingsPage() {
  const { profile, setProfile, loading, error, retry } = useMyProfile();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/owner/profile" className="text-sm font-medium text-primary-strong">
          ← Back to profile
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-bold text-text-dark">Account Settings</h1>
        <p className="mt-1 text-sm text-text-body">Notification and privacy choices, saved to your account.</p>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-text-body">Loading your settings…</p>
      ) : error || !profile ? (
        <LoadErrorCard title="Your settings could not be loaded" message={error ?? undefined} onRetry={retry} />
      ) : (
        <Card className="p-6">
          <ProfileSettingsForm role="landlord" profile={profile} onSaved={setProfile} />
        </Card>
      )}
      <div className="space-y-3">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="block">
            <Card className="p-5 hover:shadow-md">
              <p className="font-medium text-text-dark">{link.title}</p>
              <p className="mt-1 text-sm text-text-body">{link.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
