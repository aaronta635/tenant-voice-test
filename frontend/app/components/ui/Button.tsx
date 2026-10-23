'use client';

import type { FC, ButtonHTMLAttributes } from 'react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './button-styles';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  fullWidth?: boolean;
  size?: ButtonSize;
}

/**
 * Base button component with primary, secondary, and ghost variants.
 */
const Button: FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  type,
  fullWidth = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
