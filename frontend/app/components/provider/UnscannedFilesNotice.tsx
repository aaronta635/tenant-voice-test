'use client';

import { useEffect, useState } from 'react';
import DemoLabel from '@/app/components/demo/DemoLabel';
import { uploadScanning } from '@/app/lib/upload-scanning';

export const UNSCANNED_REASON = 'Not virus-scanned: files sent in messages are not checked for viruses yet. Open only the ones you expect.';

/**
 * Labels the files other people send while uploads are stored without a
 * virus scan (no scanner is connected to the backend). Nothing shows once
 * the server says it scans; if it cannot say, the label stays, as a caution.
 */
export default function UnscannedFilesNotice() {
  const [scanned, setScanned] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    uploadScanning()
      .then((state) => { if (active) setScanned(state.enabled); })
      .catch(() => { if (active) setScanned(false); });
    return () => { active = false; };
  }, []);

  if (scanned !== false) return null;
  return <DemoLabel variant="notice" reason={UNSCANNED_REASON} />;
}
