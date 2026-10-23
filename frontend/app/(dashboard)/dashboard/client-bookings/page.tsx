import { Suspense } from 'react';
import BookingList from '@/app/components/bookings/BookingList';
export const metadata = { title: 'My booking requests' };
export default function ClientBookingsPage() {
  return <Suspense fallback={<p role="status">Loading your booking requests…</p>}><BookingList scope="client" /></Suspense>;
}
