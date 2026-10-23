// The eight category codes the shared database takes for a repair and a
// service (backend services/maps_provider_core.REPAIR_CATEGORY_LABELS, the
// mobile app's mobile_repair_category_label). A provider covers some of
// them, and an owner can assign a repair only to a provider who covers its
// category.

export const REPAIR_CATEGORIES = [
  { value: 'PLUMBING', label: 'Plumbing' },
  { value: 'ELECTRICAL', label: 'Electrical' },
  { value: 'HVAC', label: 'Heating & Cooling' },
  { value: 'APPLIANCE', label: 'Appliance' },
  { value: 'LOCKS_SECURITY', label: 'Locks / Security' },
  { value: 'LEAK', label: 'Leak' },
  { value: 'SAFETY', label: 'Safety' },
  { value: 'GENERAL', label: 'General' },
] as const;

export type RepairCategory = (typeof REPAIR_CATEGORIES)[number]['value'];

/** A category's label; anything else reads as General, as the mobile app shows it. */
export function categoryLabel(code: string | null | undefined): string {
  const upper = (code ?? '').trim().toUpperCase();
  return REPAIR_CATEGORIES.find((category) => category.value === upper)?.label ?? 'General';
}
