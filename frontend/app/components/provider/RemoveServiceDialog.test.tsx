import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DraftService } from '@/app/lib/provider-workspace';
import RemoveServiceDialog from './RemoveServiceDialog';

function actions(service: DraftService): string[] {
  const html = renderToStaticMarkup(
    <RemoveServiceDialog service={service} name={service.title} onClose={() => undefined} onRemove={() => undefined} onDisable={() => undefined} />,
  );
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1]);
}

describe('removing a service during onboarding', () => {
  const service: DraftService = { id: 'appraisal', title: 'Rental appraisal', price: '150', is_active: true };

  it('offers to remove a service without bookings', () => {
    expect(actions({ ...service, booking_count: 0 })).toContain('Remove service');
  });

  it('offers to disable a booked service instead of a removal the API would refuse', () => {
    const booked = actions({ ...service, booking_count: 2 });
    expect(booked).toContain('Disable service');
    expect(booked).not.toContain('Remove service');
  });

  it('offers neither once a booked service is already disabled', () => {
    const disabled = actions({ ...service, booking_count: 2, is_active: false });
    expect(disabled).not.toContain('Remove service');
    expect(disabled).not.toContain('Disable service');
    expect(disabled).toContain('Keep service');
  });
});
