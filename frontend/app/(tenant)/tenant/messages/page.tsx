import TenantShell from '@/app/components/tenant/TenantShell';
import RentalMessages from '@/app/components/rental/RentalMessages';

export const metadata = {
  title: 'Messages',
};

export default function TenantMessagesPage() {
  return (
    <TenantShell>
      <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
        <RentalMessages />
      </main>
    </TenantShell>
  );
}
