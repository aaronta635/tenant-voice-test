import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge set up for this project's theme. The shared primitives merge
 * caller classes with it so the caller's choice wins, as in Tailwind:
 * - A fixed height (h-10, size-9) drops the primitive's min-height floor,
 *   which would otherwise still apply and keep the element 44px tall.
 * - The type scale from globals.css (text-display, text-h1 to text-h4) is a
 *   font size. Unregistered, text-h3 counts as a colour, so it removes the
 *   primitive's text colour and leaves its text-sm in place.
 */
export const mergeClasses = extendTailwindMerge({
  extend: {
    theme: { text: ['display', 'h1', 'h2', 'h3', 'h4'] },
    conflictingClassGroups: { h: ['min-h'], size: ['min-h'] },
  },
});
