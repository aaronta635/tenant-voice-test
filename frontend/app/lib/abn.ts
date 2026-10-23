// A provider's ABN (tracker assumption #5): optional, and checked with the
// Australian Business Register's checksum before it is sent, as the backend
// checks it again (services/maps_provider_core.py).

const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** The eleven digits of an ABN typed with or without spaces; null when it holds anything else. */
function abnDigits(value: string): string | null {
  const digits = value.replace(/\s+/g, '');
  return /^[0-9]{11}$/.test(digits) ? digits : null;
}

/** Take 1 from the first digit, weight the digits, and the sum divides by 89. The check digits never start with 0. */
export function isValidAbn(value: string): boolean {
  const digits = abnDigits(value);
  if (!digits || digits[0] === '0') return false;
  const sum = [...digits].reduce((total, digit, index) => total + WEIGHTS[index] * (Number(digit) - (index === 0 ? 1 : 0)), 0);
  return sum % 89 === 0;
}

/** An ABN grouped as the ABR prints it, "51 824 753 556"; anything but eleven digits stays as typed. */
export function formatAbn(value: string): string {
  const digits = abnDigits(value);
  return digits ? `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}` : value.trim();
}

/** Why the ABN typed cannot be saved, or null. Blank is fine: the ABN is optional. */
export function abnProblem(value: string): string | null {
  if (!value.trim() || isValidAbn(value)) return null;
  return 'Enter a valid 11-digit ABN, such as 51 824 753 556. Check it on ABN Lookup.';
}
