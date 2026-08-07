'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import {
  HouseIcon,
  FileTextIcon,
  KeyIcon,
  UserIcon,
  ShieldCheckIcon,
  SettingsIcon,
  BellIcon,
  HelpCircleIcon,
  LogOutIcon,
  ChevronRightIcon,
} from '@/app/components/owner/icons';
import SignOutLink from '@/app/components/SignOutLink';
import { api, safe, type OwnerDashboard, type Profile } from '@/app/lib/api';
import { initialsOf } from '@/app/lib/format';

type ProfileRowProps = {
  icon: React.ReactNode;
  label: string;
  href?: string;
  trailing?: React.ReactNode;
};

function ProfileRow({ icon, label, href, trailing }: ProfileRowProps) {
  const body = (
    <>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-primary">
        {icon}
      </div>
      <p className="flex-1 font-medium text-text-dark">{label}</p>
      {trailing}
      <ChevronRightIcon size={20} className="shrink-0 text-text-muted opacity-50" />
    </>
  );

  const className =
    'flex w-full items-center gap-4 border-b border-border px-6 py-5 text-left last:border-b-0 hover:bg-background';

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" className={className}>
      {body}
    </button>
  );
}

function StatCard({
  value,
  label,
  icon,
}: {
  value: number | string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 p-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-surface text-primary">
        {icon}
      </div>
      <p className="font-heading text-3xl font-bold text-text-dark">{value}</p>
      <p className="text-xs font-medium tracking-wide text-text-body uppercase">{label}</p>
    </Card>
  );
}

export default function OwnerProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<OwnerDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const [me, dashboard] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe<OwnerDashboard | null>(api.dashboard.owner(), null),
      ]);
      if (!active) return;
      setProfile(me);
      setStats(dashboard);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-heading text-2xl font-bold text-text-dark sm:text-[30px]">Profile</h1>

      {loading ? (
        <p className="text-text-body">Loading your profile…</p>
      ) : (
        <>
          <Card className="flex items-center gap-6 p-8">
            <div className="flex size-[88px] shrink-0 items-center justify-center rounded-full bg-surface text-2xl font-bold text-navy">
              {initialsOf(profile?.full_name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-heading text-2xl font-bold text-text-dark">
                {profile?.full_name ?? '—'}
              </p>
              <p className="mt-1 text-text-body">{profile?.email ?? '—'}</p>
              <p className="text-text-body">{profile?.phone ?? 'No phone on file'}</p>
              {profile?.location ? (
                <p className="text-text-body">
                  {[profile.location, profile.state, profile.postcode].filter(Boolean).join(' ')}
                </p>
              ) : null}
            </div>
            <ChevronRightIcon size={24} className="shrink-0 text-text-muted" />
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              value={stats?.property_count ?? 0}
              label="Properties"
              icon={<HouseIcon />}
            />
            <StatCard
              value={stats?.application_count ?? 0}
              label="Applications"
              icon={<FileTextIcon />}
            />
            <StatCard
              value={stats?.active_lease_count ?? 0}
              label="Active Leases"
              icon={<KeyIcon />}
            />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-text-body uppercase">
              Account
            </h2>
            <Card className="overflow-hidden p-0">
              <ProfileRow icon={<UserIcon size={20} />} label="Edit Profile" />
              <ProfileRow icon={<ShieldCheckIcon size={20} />} label="Identity Verification" />
              <ProfileRow icon={<SettingsIcon size={20} />} label="Account Settings" />
            </Card>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-text-body uppercase">
              Preferences
            </h2>
            <Card className="overflow-hidden p-0">
              <ProfileRow
                icon={<BellIcon size={20} />}
                label="Notifications"
                href="/owner/notifications"
                trailing={
                  stats && stats.unread_notifications > 0 ? (
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      {stats.unread_notifications} new
                    </span>
                  ) : null
                }
              />
            </Card>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold tracking-wide text-text-body uppercase">
              Support
            </h2>
            <Card className="overflow-hidden p-0">
              <ProfileRow
                icon={<HelpCircleIcon size={20} />}
                label="Help & Support"
                href="/owner/help"
              />
              <ProfileRow icon={<FileTextIcon size={20} />} label="Terms & Privacy" />
            </Card>
          </div>

          <div className="flex justify-center border-t border-border pt-6">
            <SignOutLink className="inline-flex h-12 items-center gap-2 rounded-[4px] px-4 text-sm font-medium text-[#de3b40] hover:bg-[#fee2e2]">
              <LogOutIcon size={20} />
              Log Out
            </SignOutLink>
          </div>
        </>
      )}
    </div>
  );
}
