import { describe, expect, it } from 'vitest';

import { isRemoteImage } from './remote-image';

describe('isRemoteImage', () => {
  it('is true for a photo on another host', () => {
    expect(isRemoteImage('https://abcd.supabase.co/storage/v1/object/public/property-images/o/1.png')).toBe(true);
    expect(isRemoteImage('http://127.0.0.1:54321/storage/v1/object/public/property-images/o/1.png')).toBe(true);
    expect(isRemoteImage('//cdn.example.test/1.jpg')).toBe(true);
  });

  it("is false for the app's own images and for data: URLs, which next/image already loads as is", () => {
    expect(isRemoteImage('/provider-placeholder.svg')).toBe(false);
    expect(isRemoteImage('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
    expect(isRemoteImage('')).toBe(false);
    expect(isRemoteImage(undefined)).toBe(false);
  });
});
