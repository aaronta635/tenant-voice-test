import Modal from '@/app/components/ui/Modal';
import type { DraftService } from '@/app/lib/provider-workspace';

type Props = {
  service: DraftService | null;
  name: string;
  onClose: () => void;
  onRemove: () => void;
  onDisable: () => void;
};

/**
 * Confirms removing a service during onboarding. A service with bookings
 * can't be deleted, since that would take it off those jobs, so the dialog
 * offers to disable it instead, which hides it from the public profile.
 */
export default function RemoveServiceDialog({ service, name, onClose, onRemove, onDisable }: Props) {
  const booked = (service?.booking_count ?? 0) > 0;
  const disabled = service?.is_active === false;
  return (
    <Modal open={service !== null} title={booked ? 'This service has bookings' : 'Remove service from setup?'} onClose={onClose}>
      <p>
        {booked
          ? `${name} can't be removed because it has bookings, and removing it would take it off those jobs. ${disabled ? 'It is already disabled, so it stays hidden from your public profile.' : 'Disable it instead to hide it from your public profile when you continue.'}`
          : `${name} will be removed when you continue. This cannot be undone after saving.`}
      </p>
      <div className="mt-4 flex gap-2">
        <button type="button" className="min-h-11 rounded-lg border px-4" onClick={onClose}>Keep service</button>
        {!booked ? (
          <button type="button" className="min-h-11 rounded-lg border border-danger px-4 text-danger" onClick={onRemove}>Remove service</button>
        ) : !disabled ? (
          <button type="button" className="min-h-11 rounded-lg border border-control-border px-4 font-semibold" onClick={onDisable}>Disable service</button>
        ) : null}
      </div>
    </Modal>
  );
}
