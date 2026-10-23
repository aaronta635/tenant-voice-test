import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { mergeClasses } from './merge-classes';

type ChipProps = { selected: boolean; className?: string; children: ReactNode };
type ToggleChipProps = ChipProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ChipProps | 'aria-pressed'> & { href?: undefined };
type LinkChipProps = ChipProps & { href: string; scroll?: boolean };

/**
 * The chip for every filter row, so filters look the same on each page. The
 * selected chip is bold with a check mark as well as filled, so the choice
 * never rests on colour alone. A chip is a toggle button (aria-pressed), or
 * with `href` a link to a section that marks the current one (aria-current).
 */
export default function FilterChip({ selected, className, children, ...props }: ToggleChipProps | LinkChipProps) {
  const classes = mergeClasses(
    'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm transition-colors',
    selected
      ? 'border-primary-strong bg-primary-strong font-bold text-white'
      : 'border-control-border bg-white font-medium text-text-body hover:bg-surface hover:text-text-dark',
    className,
  );
  const content = <>{selected ? <CheckIcon /> : null}{children}</>;
  if (props.href !== undefined) {
    return <Link href={props.href} scroll={props.scroll} aria-current={selected ? 'page' : undefined} className={classes}>{content}</Link>;
  }
  return <button type="button" {...props} aria-pressed={selected} className={classes}>{content}</button>;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="-ml-1 size-4 shrink-0" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}
