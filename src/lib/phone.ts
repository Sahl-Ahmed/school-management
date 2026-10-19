/**
 * Bangladeshi mobile number normalisation.
 *
 * Every phone number stored in the database is normalised to +8801XXXXXXXXX,
 * because the schema enforces that shape with a CHECK constraint and because
 * the SMS provider needs one consistent format. Guardians write their numbers
 * many ways — 01712..., 8801712..., +88 01712-345678 — so normalisation
 * happens once, here, on the way in.
 *
 * Kept free of server-only imports so it can be unit tested and reused in
 * client-side form validation.
 */

/** Operator prefixes currently in use: 013-019. */
const BD_MOBILE = /^(?:0088|88)?(01[3-9]\d{8})$/;

/**
 * Returns the number as +8801XXXXXXXXX, or null when it is not a valid
 * Bangladeshi mobile number. Callers reject on null rather than storing
 * something the database would refuse anyway.
 */
export function normaliseBdPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const match = BD_MOBILE.exec(digits);
  return match ? `+88${match[1]}` : null;
}

/** True when the value is already in the stored canonical form. */
export function isNormalisedBdPhone(value: string): boolean {
  return /^\+8801[3-9]\d{8}$/.test(value);
}

/** Formats a stored number for display: +8801712345678 -> 01712-345678. */
export function formatBdPhoneForDisplay(stored: string): string {
  if (!isNormalisedBdPhone(stored)) return stored;
  const local = stored.slice(3); // drop +88
  return `${local.slice(0, 5)}-${local.slice(5)}`;
}
