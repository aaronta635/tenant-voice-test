import { cleanup, descendants, render, textOf, type FakeElement } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UnscannedFilesNotice from './UnscannedFilesNotice';

const scanning = vi.hoisted(() => ({ uploadScanning: vi.fn() }));
vi.mock('@/app/lib/upload-scanning', () => scanning);

const labelsIn = (view: FakeElement) => descendants(view).filter((element) => element.hasAttribute('data-demo-label'));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('UnscannedFilesNotice', () => {
  it('labels other people\'s files while uploads are stored without a virus scan', async () => {
    scanning.uploadScanning.mockResolvedValue({ enabled: false });
    const view = await render(<UnscannedFilesNotice />);

    const [label] = labelsIn(view);
    expect(textOf(label)).toMatch(/^Demo: Not virus-scanned: files sent in messages are not checked for viruses yet/);
    expect(lowContrastText(view)).toEqual([]);
  });

  it('says nothing once the server scans uploads', async () => {
    scanning.uploadScanning.mockResolvedValue({ enabled: true });

    expect(labelsIn(await render(<UnscannedFilesNotice />))).toEqual([]);
  });

  it('keeps the caution when the server cannot say whether it scans', async () => {
    scanning.uploadScanning.mockRejectedValue(new Error('offline'));

    expect(labelsIn(await render(<UnscannedFilesNotice />))).toHaveLength(1);
  });

  it('shows nothing while the answer is on its way', async () => {
    scanning.uploadScanning.mockReturnValue(new Promise(() => {}));

    expect(labelsIn(await render(<UnscannedFilesNotice />))).toEqual([]);
  });
});
