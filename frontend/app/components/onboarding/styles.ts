// Classes the onboarding steps share, matching ui/Input's labels and controls.

/** A field's label or a group's legend, as ui/Input writes its labels. */
export const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.8px] text-text-body';

/** A textarea or select, as ui/Input draws its box. */
export const CONTROL =
  'mt-1.5 w-full min-w-0 rounded-lg border border-control-border bg-white p-3 text-sm text-text-dark '
  + 'focus:outline-2 focus:outline-offset-2 focus:outline-primary-strong';

/** A short line under a field or group. */
export const HINT = 'mt-1.5 text-xs text-text-body';

/** A boxed aside inside a step, such as the privacy note or the tips. */
export const NOTE = 'rounded-xl border border-border bg-background p-4 text-sm text-text-body';
