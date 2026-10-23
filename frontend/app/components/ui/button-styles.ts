import { mergeClasses } from './merge-classes';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary-strong text-white hover:bg-navy border border-transparent',
  secondary: 'bg-white text-primary-strong border border-primary-strong hover:bg-surface',
  ghost: 'bg-transparent text-text-body border border-transparent hover:bg-surface',
  destructive: 'bg-danger text-white border border-danger hover:bg-danger/90',
};
const sizes: Record<ButtonSize, string> = { sm: 'min-h-10 px-3', md: 'min-h-11 px-4', lg: 'min-h-12 px-6' };

/**
 * Classes shared by Button and ButtonLink. Kept out of the client-only Button
 * module so server components can render ButtonLink.
 */
export function buttonClassName({ variant = 'primary', size = 'md', fullWidth = false, className = '' }: {
  variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string;
}) {
  return mergeClasses(
    'inline-flex items-center justify-center gap-2',
    `rounded-lg py-2 ${sizes[size]}`,
    'text-sm font-medium leading-none',
    'transition-colors duration-150 cursor-pointer',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    variantClasses[variant],
    fullWidth ? 'w-full' : '',
    className,
  );
}
