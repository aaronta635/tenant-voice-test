import type { Metadata } from 'next';
import AdminShell from '@/app/components/admin/AdminShell';

// Staff pages stay out of search results; the server guards their data.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
