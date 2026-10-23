import type { ReactNode } from 'react';
import Card from './Card';

export default function EmptyState({ title, description, action }: {
  title: string; description?: string; action?: ReactNode;
}) {
  return <Card className="flex flex-col items-start gap-3 p-6">
    <h2 className="font-heading text-h4 font-semibold">{title}</h2>
    {description && <p className="text-sm text-text-body">{description}</p>}
    {action}
  </Card>;
}
