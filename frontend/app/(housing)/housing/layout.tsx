import type { Metadata } from 'next';
import HousingShell from '@/app/components/housing/HousingShell';

// Officer pages stay out of search results; the server guards their data.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function HousingLayout({ children }: { children: React.ReactNode }) {
  return <HousingShell>{children}</HousingShell>;
}
