'use client';

import { useEffect, useState } from 'react';
import Button from '@/app/components/ui/Button';
import { takeLegacyDocumentPicks, type LegacyPickRole } from '@/app/lib/legacy-document-picks';

/**
 * Says once that the files the old screen "uploaded" never left this browser,
 * then forgets them (lib/legacy-document-picks). Their names are never shown
 * as documents, and nothing here reads them again.
 */
export default function LegacyPicksNotice({ role }: { role: LegacyPickRole }) {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    // Client-only storage, read after mount to keep the server markup stable.
    // Taken once: the names are gone from storage as they are read.
    const taken = takeLegacyDocumentPicks(role);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (taken.length) setNames(taken);
  }, [role]);

  if (!names.length) return null;
  return (
    <div role="status" className="flex flex-col gap-3 rounded-xl border border-warning bg-white p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-text-dark">Files you picked before were not uploaded</p>
        <p className="mt-1 break-words text-text-body">
          The earlier version of this page only remembered their names in this browser ({names.join(', ')}). Nothing
          reached TenantVoice, so nobody can review them. Upload them again below.
        </p>
      </div>
      <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setNames([])}>
        Dismiss<span className="sr-only"> the note about earlier files</span>
      </Button>
    </div>
  );
}
