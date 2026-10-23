import type { ReactNode } from 'react';

export default function PageHeader({ title, description, actions }: {
  title: string; description?: string; actions?: ReactNode;
}) {
  return <header className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
    <div className="min-w-0 flex-1">
      <h1 className="font-heading text-h2 font-semibold text-text-dark">{title}</h1>
      {description && <p className="mt-2 text-sm text-text-body">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
  </header>;
}
