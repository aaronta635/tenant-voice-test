'use client';

import { useId } from 'react';
import { mergeClasses } from './merge-classes';
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
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-2 w-full min-w-0">
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
      <div className="relative flex items-center w-full min-w-0">
        {leadingIcon && (
          <span className="absolute left-3 flex items-center text-[#9a9aa3] pointer-events-none">
            {leadingIcon}
          </span>
        )}
        <input
          id={inputId}
          className={mergeClasses(
            'min-w-0 w-full min-h-11 rounded-lg py-2',
            'border border-control-border bg-white',
            'text-sm text-[#171a1f] placeholder:text-text-subtle',
            'px-3',
            leadingIcon ? 'pl-10' : '',
            trailingIcon ? 'pr-10' : '',
            'focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong',
            'transition-shadow duration-150',
            className,
          )}
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
