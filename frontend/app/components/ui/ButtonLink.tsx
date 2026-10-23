import Link from 'next/link';
import type { ComponentProps } from 'react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './button-styles';

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

/**
 * A link styled as a Button, for actions that navigate. Forced-colors mode
 * removes the fill that marks it as a button, so data-button-link opts it into
 * the outline globals.css gives buttons there.
 */
export default function ButtonLink({ variant = 'primary', size = 'md', fullWidth = false, className = '', ...props }: ButtonLinkProps) {
  return <Link data-button-link="" className={buttonClassName({ variant, size, fullWidth, className })} {...props} />;
}
