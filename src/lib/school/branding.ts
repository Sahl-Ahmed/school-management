import { publicEnv } from "@/lib/env";

/**
 * Public URLs for files in the `branding` bucket.
 *
 * `branding` is the one Storage bucket marked public (migration 0018), because
 * a school logo appears on a page anonymous visitors read — the public ID card
 * — and on printed documents. Nothing else about the school is public, so this
 * helper only ever builds URLs for that bucket.
 *
 * Deliberately free of server-only imports: the public card page renders in a
 * Server Component and the PDF generators read the same paths, so both need it.
 */

const BUCKET = "branding";

/**
 * The public URL for a branding path, or null when there is no file.
 *
 * Returns null rather than a broken URL for an absent logo: the school has not
 * supplied one yet (decision 3), and every caller should treat that as "no
 * logo" rather than rendering an image that 404s.
 *
 * A path that already looks like a URL is passed through, so a school that
 * prefers to host its logo elsewhere can store a full URL instead.
 */
export function brandingUrl(path: string | null | undefined): string | null {
  if (!path) return null;

  const trimmed = path.trim();
  if (trimmed === "") return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const base = publicEnv().NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
  // Leading slashes would produce a double slash in the object path, which
  // Storage treats as a different (missing) key.
  const key = trimmed.replace(/^\/+/, "");

  return `${base}/storage/v1/object/public/${BUCKET}/${key}`;
}
