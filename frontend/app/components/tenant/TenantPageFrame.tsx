'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/app/components/ui/Card';
import { api, safe, type NotificationItem, type Profile } from '@/app/lib/api';
import { relativeTime } from '@/app/lib/format';
import { completionScore } from '@/app/lib/my-profile';
import type { TenantScreen } from '@/app/lib/tenant-data';

/** Profile-completion percentage, as the server worked it out for /profiles/me. */
export function completionFor(profile: Profile | null): number {
  return completionScore(profile);
}

export function PageFrame({
  screen,
  children,
  side,
}: {
  screen: TenantScreen;
  children: React.ReactNode;
  side?: React.ReactNode;
}) {
  return (
    <main className="mx-auto grid w-full max-w-[1240px] gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary-strong">
          {screen.eyebrow ?? 'Tenant workspace'}
        </p>
        <h1 className="mt-2 font-heading text-[30px] font-semibold leading-9 tracking-tight text-[#171a1f]">
          {screen.title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[#565d6d]">{screen.description}</p>
        <div className="mt-8">{children}</div>
      </section>
      <aside className="space-y-6">{side ?? <DefaultSide />}</aside>
    </main>
  );
}

export function DefaultSide() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [me, feed] = await Promise.all([
        safe<Profile | null>(api.profiles.me(), null),
        safe(api.notifications.list(false, 3), []),
      ]);
      if (!active) return;
      setProfile(me);
      setNotifications(feed);
    })();
    return () => {
      active = false;
    };
  }, []);

  const completion = completionFor(profile);

  return (
    <>
      <Card className="rounded-[16px] border border-[#dee1e6] p-6">
        <h2 className="text-base font-bold">Profile Completion</h2>
        <div className="mt-6 h-2.5 rounded-full bg-[#e5e7eb]">
          <div className="h-full rounded-full bg-primary" style={{ width: `${completion}%` }} />
        </div>
        <div className="mt-4 flex justify-between text-sm">
          <span>{completion}% Complete</span>
          <Link href="/tenant/profile-completion" className="text-primary-strong">
            Finish Setup ›
          </Link>
        </div>
      </Card>
      <Card className="rounded-[16px] border border-[#dee1e6] p-6">
        <h2 className="text-base font-bold">Recent Activity</h2>
        {notifications.length === 0 ? (
          <p className="mt-4 text-sm text-[#565d6d]">Nothing yet.</p>
        ) : (
          <ul className="mt-4 space-y-4 text-sm text-[#565d6d]">
            {notifications.map((item) => (
              <li key={item.id}>
                <span className="block text-[#171a1f]">{item.title}</span>
                <span className="text-xs">{relativeTime(item.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
