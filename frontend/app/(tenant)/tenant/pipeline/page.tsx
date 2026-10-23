import TenantShell from '@/app/components/tenant/TenantShell';
import RentalPipeline from '@/app/components/rental/RentalPipeline';

export const metadata = {
  title: 'Rental Pipeline',
};

export default function TenantPipelinePage() {
  return (
    <TenantShell>
      <main className="mx-auto w-full max-w-[1240px] px-6 py-8">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            Full pipeline
          </p>
          <h1 className="mt-2 font-heading text-[30px] font-semibold leading-9 tracking-tight">
            Renting process from search to move-in
          </h1>
          <p className="mt-1 text-sm text-[#565d6d]">
            Follow each step from finding a home to moving in.
          </p>
        </div>
        <RentalPipeline />
      </main>
    </TenantShell>
  );
}
