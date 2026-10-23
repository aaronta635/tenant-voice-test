import type { Metadata } from 'next';

export const metadata: Metadata = { title: { absolute: 'Reviews · TenantVoice' } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
