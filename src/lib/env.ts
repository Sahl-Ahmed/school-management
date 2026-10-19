import { z } from "zod";

/**
 * Environment validation.
 *
 * Split deliberately into two schemas. `publicEnv` holds only values that are
 * safe in browser bundles; `serverEnv` holds the rest and throws if it is ever
 * imported from client code, so a service-role key cannot reach the browser by
 * an accidental import.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SCHOOL_TIMEZONE: z.string().default("Asia/Dhaka"),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(["en", "bn"]).default("en"),
});

type PublicEnv = z.infer<typeof publicSchema>;

let cachedPublicEnv: PublicEnv | null = null;

/**
 * Validated public environment.
 *
 * Deliberately a function rather than a module-scope constant. Validating at
 * import time would make `next build` fail on a machine that has no Supabase
 * credentials — including CI that only type-checks and builds — because Next
 * imports every route module while collecting page data. Validating on first
 * use keeps the build credential-free while still failing loudly, with a
 * useful message, the moment a request actually needs Supabase.
 */
export function publicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;

  // Next.js inlines process.env.NEXT_PUBLIC_* only where it is referenced
  // statically, so each key is named explicitly rather than spread.
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SCHOOL_TIMEZONE: process.env.NEXT_PUBLIC_SCHOOL_TIMEZONE,
    NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  });

  if (!parsed.success) {
    throw new Error(
      "Missing or invalid public environment variables. Copy .env.example to " +
        ".env.local and fill in your Supabase project values.\n" +
        parsed.error.issues
          .map((i) => `  ${i.path.join(".")}: ${i.message}`)
          .join("\n"),
    );
  }

  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SMS_MODE: z.enum(["simulate", "live"]).default("simulate"),
  SMS_PROVIDER: z.string().default("smsbd"),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  SMS_API_BASE: z.string().url().default("https://sms.bd/api"),
  K40_BRIDGE_SHARED_SECRET: z.string().optional(),
});

type ServerEnv = z.infer<typeof serverSchema>;

let cachedServerEnv: ServerEnv | null = null;

/**
 * Server-only environment. Call this inside a server action, route handler or
 * server component — never at module scope in shared code.
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser. This is a bug.");
  }

  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      "Missing or invalid server environment variables:\n" +
        parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"),
    );
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

// NOTE: whether SMS is simulated is decided in lib/sms/index.ts, not here. It
// depends on more than SMS_MODE — a mode of "live" with no API key is still a
// simulation — and having two answers to that question is how a simulated send
// ends up reported as a real one.
