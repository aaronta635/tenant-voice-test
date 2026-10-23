import ProviderJobRequests from '@/app/components/provider/ProviderJobRequests';
import ProviderRepairs from '@/app/components/provider/ProviderRepairs';

export default function ProviderRepairsPage() {
  return (
    <div className="space-y-10">
      <ProviderRepairs />
      <ProviderJobRequests />
    </div>
  );
}
