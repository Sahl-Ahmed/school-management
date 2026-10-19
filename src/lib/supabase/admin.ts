import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role Supabase client. BYPASSES ROW LEVEL SECURITY.
 *
 * `import "server-only"` above makes a build fail rather than silently ship
 * this into a client bundle.
 *
 * Legitimate callers are narrow and should stay narrow:
 *   * provisioning accounts (the authority creates students and teachers)
 *   * resolving a registration number to an auth identity at login
 *   * OTP issue and verification
 *   * the SMS dispatcher and the daily attendance job
 *   * ingesting K40 punch logs from the on-site bridge
 *
 * Anything that acts on behalf of a signed-in user must use the request-scoped
 * client from ./server.ts instead, so that the user's own permissions apply.
 * If you are reaching for this client to read a student's record, stop and
 * check whether RLS would have allowed it: that is usually the real question.
 */
export function createAdminClient() {
  const env = publicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = serverEnv();

  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
