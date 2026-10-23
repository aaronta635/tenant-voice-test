// Whether the backend virus-scans uploads before storing them (backend
// services/uploads.py, tracker assumption #22). While it does not, every file
// is stored unscanned, so pages that show files other people sent label them.

import { apiFetch } from './api';

export type UploadScanning = { enabled: boolean };

let state: Promise<UploadScanning> | null = null;

/** The server's answer, asked once per page load: it changes only with the backend's settings. */
export function uploadScanning(): Promise<UploadScanning> {
  state ??= apiFetch<UploadScanning>('/uploads/scanning').catch((err: unknown) => {
    // A failed answer is asked again next time rather than kept.
    state = null;
    throw err;
  });
  return state;
}
