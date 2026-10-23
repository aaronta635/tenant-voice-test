import { cleanup, render, surfaceStyle } from './test-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Card from './Card';
import EmptyState from './EmptyState';
import LoadErrorCard from './LoadErrorCard';
import Modal from './Modal';
import StatCard from './StatCard';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

async function rootStyle(ui: ReactNode) {
  const container = await render(ui);
  return surfaceStyle(container.children[0]);
}

describe('Card', () => {
  it('rounds dashboard cards to the 16px radius-xl that DESIGN_SYSTEM.md documents', async () => {
    expect(await rootStyle(<Card />)).toEqual(['bg-white', 'border', 'border-border', 'rounded-2xl', 'shadow-sm']);
  });

  it('keeps the shared error, empty and stat cards on the plain card style', async () => {
    const plain = await rootStyle(<Card />);

    expect(await rootStyle(<LoadErrorCard />)).toEqual(plain);
    expect(await rootStyle(<EmptyState title="No services yet" />)).toEqual(plain);
    expect(await rootStyle(<StatCard label="Connections" value="0" />)).toEqual(plain);
  });
});

describe('Modal', () => {
  it('rounds dialogs like dashboard cards, the 16px radius-xl DESIGN_SYSTEM.md lists for modals', async () => {
    const radius = async (ui: ReactNode) => (await rootStyle(ui)).filter((utility) => utility.startsWith('rounded'));

    expect(await radius(<Modal open title="Decline connection request?" onClose={() => undefined}>Decline?</Modal>)).toEqual(await radius(<Card />));
  });
});
