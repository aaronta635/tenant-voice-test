'use client';

import { useState } from 'react';
import { initialsOf } from '@/app/lib/format';

type Props = { name: string; url: string | null; size?: 'md' | 'lg' };

const SIZES = { md: 'size-12 text-sm', lg: 'size-24 text-2xl' };

/**
 * A member's photo over their initials. The initials show while the photo
 * loads and stay if it fails. Decorative: the name is always next to it.
 */
export default function ProfileAvatar({ name, url, size = 'md' }: Props) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span aria-hidden className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface font-bold text-primary-strong ${SIZES[size]}`}>
      {initialsOf(name)}
      {url && failedUrl !== url ? (
        // Avatars come from shared storage or the mobile app, not a next/image host.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" onError={() => setFailedUrl(url)} />
      ) : null}
    </span>
  );
}
