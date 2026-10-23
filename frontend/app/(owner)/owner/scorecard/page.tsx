import type { Metadata } from 'next';
import OwnerScorecards from '@/app/components/owner/OwnerScorecards';

export const metadata: Metadata = { title: 'Scorecards' };

// The scorecard requests tenants sent this owner or agent, to complete or decline (R43).
export default function OwnerScorecardPage() {
  return <OwnerScorecards />;
}
