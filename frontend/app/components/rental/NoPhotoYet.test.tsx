import { cleanup, render, textOf } from '@/app/components/ui/test-dom';
import { lowContrastText } from '@/app/components/ui/test-contrast';
import { afterEach, describe, expect, it } from 'vitest';
import { listingPhoto } from '@/app/lib/listing-photo';
import NoPhotoYet from './NoPhotoYet';

afterEach(cleanup);

describe('NoPhotoYet', () => {
  it('fills the photo frame with words at AA contrast, taking the caller\'s size', async () => {
    const view = await render(<NoPhotoYet className="text-xs" />);
    const [placeholder] = view.children;

    expect(textOf(placeholder)).toBe('No photo yet');
    expect(placeholder.className.split(' ')).toEqual(expect.arrayContaining(['h-full', 'w-full', 'bg-surface', 'text-xs']));
    expect(placeholder.className.split(' ')).not.toContain('text-sm');
    expect(lowContrastText(view)).toEqual([]);
  });
});

describe('listingPhoto', () => {
  it('is the first photo a listing has, and nothing for one without', () => {
    expect(listingPhoto(['https://example.test/1.png', 'https://example.test/2.png'])).toBe('https://example.test/1.png');
    expect(listingPhoto([])).toBeNull();
    expect(listingPhoto([''])).toBeNull();
    expect(listingPhoto(null)).toBeNull();
    expect(listingPhoto(undefined)).toBeNull();
  });
});
