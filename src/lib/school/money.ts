/**
 * Money formatting.
 *
 * Amounts are BDT and stored as `numeric`, never floating point, so they
 * arrive from PostgREST as strings. Passing a string straight into a template
 * would print "550.00" in one place and "550" in another, so everything goes
 * through here.
 *
 * The taka sign is written as ৳ (U+09F3) rather than "Tk" or "BDT", which is
 * what the school's own paperwork uses.
 */

/** "৳1,250" — grouped, no decimals when the amount is whole. */
export function taka(amount: number | string | null | undefined): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return "৳0";

  const whole = Number.isInteger(value);
  return `৳${value.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Plain grouped number without the sign, for table columns with a header. */
export function amountOnly(amount: number | string | null | undefined): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "May 2026" from a fee charge's period columns. */
export function periodLabel(
  year: number | null,
  month: number | null,
  examName?: string | null,
): string {
  if (examName) return examName;
  if (year && month) return `${MONTHS[month - 1]} ${year}`;
  return "One-off";
}

export { MONTHS };
