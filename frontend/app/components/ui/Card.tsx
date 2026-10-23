import { mergeClasses } from './merge-classes';
import type { FC, HTMLAttributes } from 'react';

type CardVariant = 'dashboard' | 'auth';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantClasses: Record<CardVariant, string> = {
  dashboard:
    'bg-white rounded-2xl border border-border shadow-sm',
  auth:
    'bg-[rgba(255,255,255,0.9)] backdrop-blur-[12px] rounded-[4px] border border-[#dee1e6] shadow-[0px_2px_5px_rgba(23,26,31,0.09),0px_0px_2px_rgba(23,26,31,0.12)]',
};

/**
 * Card container component.
 * - `dashboard` variant: 16px corners (`rounded-2xl`, DESIGN_SYSTEM.md radius-xl), token border
 *   and shadow-sm. Callers add spacing and layout only, never their own radius, border or shadow.
 * - `auth` variant: rounded-[4px], glassmorphic bg with border (for auth screens)
 */
const Card: FC<CardProps> = ({
  variant = 'dashboard',
  className = '',
  children,
  ...props
}) => {
  return (
    <div
      className={mergeClasses(variantClasses[variant], className)}
      {...props}
    >
      {children}
    </div>
  );
};

export default Card;
