import { publicEnv } from "@/lib/env";

/**
 * School dates and times, in the school's own timezone.
 *
 * Everything the attendance and routine screens show is a school-day concept:
 * "today", "this month", "which weekday is this". Computing those from the
 * server's clock would put a lesson on the wrong day whenever the server runs
 * in UTC and the school is at UTC+6 — between 18:00 and midnight Dhaka time,
 * `new Date().getDay()` on a UTC server is already the previous day.
 *
 * So every date here is derived in Asia/Dhaka (or whatever
 * NEXT_PUBLIC_SCHOOL_TIMEZONE says), and passed to the database as a plain
 * `date` string rather than a timestamp.
 */

function timezone(): string {
  return publicEnv().NEXT_PUBLIC_SCHOOL_TIMEZONE;
}

/** Today in the school's timezone, as YYYY-MM-DD. */
export function schoolToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The weekday of a YYYY-MM-DD date, Postgres dow: 0 = Sunday. */
export function weekdayOf(isoDate: string): number {
  // Parsed as UTC midnight deliberately: the string is already a calendar date
  // in the school's timezone, so no further conversion should happen.
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** First and last day of the month containing `isoDate`. */
export function monthBounds(isoDate: string): { from: string; to: string } {
  const [y, m] = isoDate.split("-").map(Number);
  const year = y!;
  const month = m!;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${String(month).padStart(2, "0")}-01`,
    to: `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

/** "May 2026", for chart period labels. */
export function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, (m ?? 1) - 1, 1)));
}

/** "Sunday 19 October 2026", for a date heading. */
export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)));
}

/** Shifts a YYYY-MM-DD date by whole days. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days));
  return shifted.toISOString().slice(0, 10);
}

/** Shifts by whole months, clamping the day to the target month's length. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y!, (m ?? 1) - 1 + months, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * A percentage from a numerator and denominator, or null when there is no
 * denominator.
 *
 * Returns null rather than 0 on purpose. Zero would be displayed as a real
 * measurement — "0% attendance" — when the truth is that nothing has been
 * submitted yet. Callers must handle null as "no data".
 */
export function percentage(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
