import OwnerShell from '@/app/components/owner/OwnerShell';

export default function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <OwnerShell>{children}</OwnerShell>;
}
