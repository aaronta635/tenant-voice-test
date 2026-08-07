import type { FC, HTMLAttributes } from 'react';

type CardVariant = 'dashboard' | 'auth';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantClasses: Record<CardVariant, string> = {
  dashboard:
    'bg-white rounded-[16px] shadow-[0px_2px_2.5px_rgba(23,26,31,0.09),0px_0px_1px_rgba(23,26,31,0.12)]',
  auth:
    'bg-[rgba(255,255,255,0.9)] backdrop-blur-[12px] rounded-[4px] border border-[#dee1e6] shadow-[0px_2px_5px_rgba(23,26,31,0.09),0px_0px_2px_rgba(23,26,31,0.12)]',
};

/**
 * Card container component.
 * - `dashboard` variant: rounded-[16px], standard shadow (for dashboard quick-access cards)
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
      className={[variantClasses[variant], className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </div>
  );
};

export default Card;
