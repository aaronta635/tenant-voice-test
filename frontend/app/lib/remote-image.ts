// Listing photos are absolute URLs: the shared Supabase project's public
// property-images bucket, or wherever the mobile app keeps a photo. next/image
// refuses to optimise a host next.config.ts does not list (it throws in
// development and answers 400 in production), and those hosts are not known
// when the app is built. So a remote photo loads as is, while the app's own
// images are still optimised.

/** Whether next/image must load src unoptimized: it is on another host. */
export function isRemoteImage(src: string | null | undefined): boolean {
  return /^(https?:)?\/\//i.test(src ?? '');
}
