'use client';

import type { FC, InputHTMLAttributes, ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  labelClassName?: string;
}

/**
 * Input field with optional label, leading icon slot, and trailing icon slot.
 * Styled to match TenantVoice design system.
 */
const Input: FC<InputProps> = ({
  label,
  leadingIcon,
  trailingIcon,
  labelClassName = '',
  className = '',
  id,
  ...props
}) => {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="flex flex-col gap-[6px] w-full">
      {label && (
        <label
          htmlFor={inputId}
          className={[
            'text-[11px] font-semibold uppercase tracking-[0.8px] text-[#565d6d]',
            labelClassName,
          ].join(' ')}
        >
          {label}
        </label>
      )}
      <div className="relative flex items-center w-full">
        {leadingIcon && (
          <span className="absolute left-3 flex items-center text-[#9a9aa3] pointer-events-none">
            {leadingIcon}
          </span>
        )}
        <input
          id={inputId}
          className={[
            'w-full h-[46px] rounded-[4px]',
            'border border-[#dee1e6] bg-[rgba(243,244,246,0.4)]',
            'text-sm text-[#171a1f] placeholder:text-[#9a9aa3]',
            'px-3',
            leadingIcon ? 'pl-10' : '',
            trailingIcon ? 'pr-10' : '',
            'focus:outline-none focus:ring-2 focus:ring-[#636ae8] focus:border-transparent',
            'transition-shadow duration-150',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...props}
        />
        {trailingIcon && (
          <span className="absolute right-3 flex items-center text-[#9a9aa3] pointer-events-none">
            {trailingIcon}
          </span>
        )}
      </div>
    </div>
  );
};

export default Input;
