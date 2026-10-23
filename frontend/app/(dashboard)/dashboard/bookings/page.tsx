import { Suspense } from 'react';
import BookingList from '@/app/components/bookings/BookingList';

export default function BookingsPage() {
  return <Suspense fallback={<p role="status">Loading bookings…</p>}><BookingList /></Suspense>;
}
