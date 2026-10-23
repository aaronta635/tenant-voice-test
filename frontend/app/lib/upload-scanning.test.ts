import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('./api', () => http);

beforeEach(() => {
  vi.resetModules();
  http.apiFetch.mockReset();
});

describe('uploadScanning', () => {
  it('asks the server once and shares its answer', async () => {
    http.apiFetch.mockResolvedValue({ enabled: true });
    const { uploadScanning } = await import('./upload-scanning');

    expect(await uploadScanning()).toEqual({ enabled: true });
    expect(await uploadScanning()).toEqual({ enabled: true });
    expect(http.apiFetch).toHaveBeenCalledTimes(1);
    expect(http.apiFetch).toHaveBeenCalledWith('/uploads/scanning');
  });

  it('asks again after a failed answer instead of keeping it', async () => {
    http.apiFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ enabled: false });
    const { uploadScanning } = await import('./upload-scanning');

    await expect(uploadScanning()).rejects.toThrow('offline');
    expect(await uploadScanning()).toEqual({ enabled: false });
    expect(http.apiFetch).toHaveBeenCalledTimes(2);
  });
});
