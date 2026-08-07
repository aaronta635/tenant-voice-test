'use client';

import type { FC, ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[#636ae8] text-white hover:bg-[#5258d4] active:bg-[#4a50c2] border border-transparent',
  secondary:
    'bg-transparent text-[#636ae8] border border-[#636ae8] hover:bg-[#f2f2fd] active:bg-[#e8e8fc]',
  ghost:
    'bg-transparent text-[#565d6d] border border-transparent hover:bg-[#f2f2fd] active:bg-[#e8e8fc]',
};

/**
 * Base button component with primary, secondary, and ghost variants.
 */
const Button: FC<ButtonProps> = ({
  variant = 'primary',
  fullWidth = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <button
      className={[
        'inline-flex items-center justify-center gap-2',
        'rounded-[4px] px-4 h-[48px]',
        'text-sm font-medium leading-none',
        'transition-colors duration-150 cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#636ae8] focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
        fullWidth ? 'w-full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
