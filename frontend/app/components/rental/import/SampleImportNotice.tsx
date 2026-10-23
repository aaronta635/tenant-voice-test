import DemoLabel from '@/app/components/demo/DemoLabel';

/**
 * The sample a site that refuses to be read offers instead (tracker
 * assumption #7, docs/demo-features.md) is a made-up listing: wherever its
 * details show, this says so.
 */
export default function SampleImportNotice({ className }: { className?: string }) {
  return (
    <DemoLabel
      variant="notice"
      reason="Sample import: these details are a made-up listing, not the one you linked. Replace every field with your own before you publish."
      className={className}
    />
  );
}
