'use client';

import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center px-6 py-16">
      <Card className="w-full rounded-[16px] border border-[#dee1e6] p-8 text-center">
        <h1 className="font-heading text-2xl font-semibold text-[#171a1f]">Page unavailable</h1>
        <p className="mt-2 text-sm text-[#565d6d]">
          {error.message || 'Something went wrong while loading this page.'}
        </p>
        <Button className="mt-6 h-10 rounded-[8px]" onClick={reset}>
          Try again
        </Button>
      </Card>
    </main>
  );
}
