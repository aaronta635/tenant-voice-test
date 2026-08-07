import ProviderShell from '@/app/components/provider/ProviderShell';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProviderShell>{children}</ProviderShell>;
}
