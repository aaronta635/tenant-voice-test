import { mergeClasses } from '@/app/components/ui/merge-classes';

/**
 * What a listing without photos of its own shows where its photo goes: words,
 * never a stock photo that could pass for the home. It fills the frame it is
 * put in, as the owner's pages show a listing without photos.
 */
export default function NoPhotoYet({ className }: { className?: string }) {
  return (
    <div className={mergeClasses('flex h-full w-full items-center justify-center bg-surface p-2 text-center text-sm text-text-body', className)}>
      No photo yet
    </div>
  );
}
