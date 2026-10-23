import { Suspense } from 'react';
import BookingList from '@/app/components/bookings/BookingList';
export const metadata = { title: 'Service bookings' };
export default function OwnerBookingsPage() {
  return <main><Suspense fallback={<p role="status">Loading bookings…</p>}><BookingList scope="owner" /></Suspense></main>;
}
