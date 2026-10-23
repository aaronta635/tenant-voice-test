import { Suspense } from 'react';
import BookingList from '@/app/components/bookings/BookingList';
import TenantShell from '@/app/components/tenant/TenantShell';
export const metadata = { title: 'Service bookings' };
export default function TenantBookingsPage() {
  return <TenantShell><main className="mx-auto w-full max-w-6xl px-6 py-8"><Suspense fallback={<p role="status">Loading bookings…</p>}><BookingList scope="tenant" /></Suspense></main></TenantShell>;
}
