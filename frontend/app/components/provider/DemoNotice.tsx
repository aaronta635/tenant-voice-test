import DemoLabel from '@/app/components/demo/DemoLabel';

/** The Demo notice of a seeded walkthrough provider (lib/demo.ts), on its workspace and public profile. */
export default function DemoNotice() {
  return <DemoLabel variant="notice" className="mb-6 print:hidden" reason="Sample business, bookings, reviews and earnings for a TenantVoice walkthrough." />;
}
