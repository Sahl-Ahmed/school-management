/**
 * Creates or restores the school owner's own sign-in accounts.
 *
 * Run with: npm run demo:accounts
 *
 * WHY THIS EXISTS AS A SCRIPT, not a one-off: the owner signs in as a student
 * with a registration number and as a teacher with an employee code, so those
 * accounts must live on the synthetic `.invalid` domains — the same addresses
 * the remote verification suites use. Those suites reset a password every time
 * they run, because they need to sign in as the seeded people themselves. So
 * running `npm run test:remote` silently breaks the owner's logins, and this
 * puts them back.
 *
 * The cleanup sweep already spares these accounts (they are tagged
 * `created_by: "owner-demo"`); only the password gets clobbered.
 *
 * The password is read from OWNER_DEMO_PASSWORD, or generated and written to
 * SIGN-IN.local.md, which .gitignore excludes. It is never printed here.
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const CREDENTIALS_FILE = "SIGN-IN.local.md";

/**
 * The password to set.
 *
 * Reuses the one already in the credentials file when there is one, so running
 * this twice does not invalidate the note the owner is reading from.
 */
function resolvePassword() {
  if (process.env.OWNER_DEMO_PASSWORD) {
    return { password: process.env.OWNER_DEMO_PASSWORD, source: "OWNER_DEMO_PASSWORD" };
  }

  if (existsSync(CREDENTIALS_FILE)) {
    const existing = readFileSync(CREDENTIALS_FILE, "utf8");
    // The file stores it in a fenced block of its own.
    const match = existing.match(/```\r?\n(\S+)\r?\n```/);
    if (match) return { password: match[1], source: CREDENTIALS_FILE };
  }

  return { password: `Sch00l-${randomBytes(6).toString("base64url")}!`, source: "generated" };
}

const { password, source } = resolvePassword();

/** The seeded people the owner's logins attach to. */
const PEOPLE = {
  teachers: [
    ["7eac0000-0000-4000-8000-000000000001", "Demo Teacher One", "T-001"],
    ["7eac0000-0000-4000-8000-000000000002", "Demo Teacher Two", "T-002"],
    ["7eac0000-0000-4000-8000-000000000003", "Demo Teacher Three", "T-003"],
  ],
  students: [
    ["57000000-0000-4000-8000-000000000001", "Demo Student Alpha", "STU-2026-0001"],
    ["57000000-0000-4000-8000-000000000002", "Demo Student Beta", "STU-2026-0002"],
    ["57000000-0000-4000-8000-000000000005", "Demo Student Epsilon", "STU-2026-0005"],
  ],
};

async function provision(email, role, fullName, link) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { created_by: "owner-demo" },
  });

  let userId;
  if (error) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email === email);
    if (!existing) throw new Error(`${email}: ${error.message}`);
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      // Re-tagged, so a suite that recreated the account does not leave it
      // exposed to the next cleanup sweep.
      user_metadata: { created_by: "owner-demo" },
    });
  } else {
    userId = data.user.id;
  }

  await admin.from("profiles").upsert({
    id: userId,
    role,
    full_name: fullName,
    must_set_password: false,
    activated_at: new Date().toISOString(),
    is_active: true,
  });

  if (link) {
    await admin.from(link.table).update({ auth_user_id: userId }).eq("id", link.id);
  }
}

console.log(`Restoring the owner's demo accounts (password source: ${source}).\n`);

await provision("principal@school.example", "authority_admin", "School Principal");
console.log("  authority_admin  principal@school.example");

await provision("office@school.example", "authority_staff", "Office Staff");
console.log("  authority_staff  office@school.example");

for (const [id, name, code] of PEOPLE.teachers) {
  await provision(`t-${id}@teachers.school.invalid`, "teacher", name, {
    table: "teachers", id,
  });
  console.log(`  teacher          ${code}  (${name})`);
}

for (const [id, name, reg] of PEOPLE.students) {
  await provision(`s-${id}@students.school.invalid`, "student", name, {
    table: "students", id,
  });
  console.log(`  student          ${reg}  (${name})`);
}

// Confirm each one can actually sign in, rather than assuming the reset worked.
const anon = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

let failures = 0;
const emails = [
  "principal@school.example",
  "office@school.example",
  ...PEOPLE.teachers.map(([id]) => `t-${id}@teachers.school.invalid`),
  ...PEOPLE.students.map(([id]) => `s-${id}@students.school.invalid`),
];

for (const email of emails) {
  const client = anon();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`  FAILED to sign in: ${email} — ${error.message}`);
    failures += 1;
  } else {
    await client.auth.signOut();
  }
}

if (source === "generated") {
  console.log(
    `\nA new password was generated. It is NOT printed here; write it into ` +
    `${CREDENTIALS_FILE} or set OWNER_DEMO_PASSWORD and run this again.`,
  );
  writeFileSync(
    ".owner-demo-password",
    `${password}\n`,
    { encoding: "utf8" },
  );
  console.log("It has been written to .owner-demo-password (gitignored).");
}

console.log(
  failures === 0
    ? `\nAll ${emails.length} logins verified.`
    : `\n${failures} login(s) could not be verified.`,
);

process.exit(failures === 0 ? 0 : 1);
