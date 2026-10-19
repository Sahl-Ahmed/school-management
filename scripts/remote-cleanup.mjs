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
// <something>.phase1-verification@school.invalid. Nothing else is ever matched,
// so a real authority account created by hand is never touched.
const REMOVABLE = /@(students|teachers)\.school\.invalid$|^[a-z0-9-]+\.phase1-verification@school\.invalid$/;

const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (error) {
  console.error(`Could not list users: ${error.message}`);
  process.exit(1);
}

const targets = data.users.filter((u) => u.email && REMOVABLE.test(u.email));

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
