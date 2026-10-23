/** A listing's first photo, or null when it has none: the page then shows NoPhotoYet, never a stock photo. */
export function listingPhoto(photoUrls: readonly string[] | null | undefined): string | null {
  return photoUrls?.[0] || null;
}
