'use client';

import { useRouter } from 'next/navigation';
import Button from '@/app/components/ui/Button';
import Card from '@/app/components/ui/Card';

export default function LoadErrorCard({
  title = 'Something went wrong',
  message = 'This page could not be loaded right now. Please try again.',
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  const router = useRouter();

  return (
    <Card className="mx-auto mt-10 max-w-xl p-8 text-center">
      <h2 className="font-heading text-xl font-semibold text-[#171a1f]">{title}</h2>
      <p className="mt-2 text-sm text-[#565d6d]">{message}</p>
      <Button
        variant="secondary"
        className="mt-5 h-10 rounded-[8px]"
        onClick={onRetry ?? (() => router.refresh())}
      >
        Try again
      </Button>
    </Card>
  );
}
