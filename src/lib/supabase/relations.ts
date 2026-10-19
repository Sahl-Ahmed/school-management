/**
 * Normalises an embedded relation returned by PostgREST.
 *
 * Without generated database types, `supabase-js` cannot tell a to-one
 * embed (`classes(name)`) from a to-many one, so it types every embed as an
 * array. At runtime a to-one embed arrives as a single object — or as an
 * array of one, depending on how the relationship is detected.
 *
 * Rather than casting at each call site, this accepts both shapes and returns
 * the single row or null.
 *
 * Once `npm run db:types` has been run against a real project, the generated
 * types resolve to-one embeds correctly and most uses of this helper can go.
 */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
