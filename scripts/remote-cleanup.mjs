/**
 * Removes the accounts and rows created by tests/remote-access.test.ts.
 *
 * Run with: npm run test:remote:cleanup
 *
 * Only touches accounts on the synthetic `.invalid` domains and the
 * verification authority address. It will not delete anything else, and it
 * prints what it removed so the result is checkable.
 */

import { createClient } from "@supabase/supabase-js";
import { remoteCredentialStatus } from "../tests/load-env.mjs";

const status = remoteCredentialStatus();
if (!status.ready) {
  console.error(`Cannot run: .env.local is missing ${status.missing.join(", ")}`);
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Synthetic student/teacher identities, plus any verification account named
// <something>.phase<N>-<tag>@school.invalid. Nothing else is ever matched, so a
// real authority account created by hand is never touched. The phase number is
// a pattern rather than a literal because each phase's remote suite uses its
// own tag, and phase 2 left an account behind when this only matched phase 1.
const REMOVABLE =
  /@(students|teachers)\.school\.invalid$|^[a-z0-9-]+\.phase\d+-[a-z0-9-]+@school\.invalid$/;

const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (error) {
  console.error(`Could not list users: ${error.message}`);
  process.exit(1);
}

/*
 * Accounts the school owner uses to sign in and look around are tagged
 * `created_by: "owner-demo"` when they are created, and are never removed here.
 *
 * Without this, the sweep would delete the owner's own student and teacher
 * logins the next time anyone ran the remote tests: those logins must sit on
 * the synthetic `.invalid` domains, because that is how a registration number
 * or an employee code maps to an Auth identity.
 */
const targets = data.users.filter(
  (u) =>
    u.email &&
    REMOVABLE.test(u.email) &&
    u.user_metadata?.created_by !== "owner-demo",
);

const kept = data.users.filter(
  (u) => u.user_metadata?.created_by === "owner-demo",
).length;

if (kept > 0) {
  console.log(`Keeping ${kept} owner demo account(s).`);
}

if (targets.length === 0) {
  console.log("Nothing to clean up.");
  process.exit(0);
}

console.log(`Removing ${targets.length} verification account(s):`);

for (const user of targets) {
  // Detach from the seeded rows first so the FK does not block, then delete
  // the profile, then the auth user.
  await admin.from("students").update({ auth_user_id: null }).eq("auth_user_id", user.id);
  await admin.from("teachers").update({ auth_user_id: null }).eq("auth_user_id", user.id);
  await admin.from("profiles").delete().eq("id", user.id);

  const { error: delError } = await admin.auth.admin.deleteUser(user.id);
  console.log(`  ${user.email} — ${delError ? `FAILED: ${delError.message}` : "removed"}`);
}

console.log("\nSeed data itself is untouched. Re-run `npm run test:remote` to recreate accounts.");
