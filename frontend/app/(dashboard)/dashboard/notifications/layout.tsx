import type { Metadata } from 'next';

export const metadata: Metadata = { title: { absolute: 'Notifications · TenantVoice' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
