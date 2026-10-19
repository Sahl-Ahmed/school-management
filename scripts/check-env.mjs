/**
 * Checks .env.local without revealing any value.
 *
 * Reports, per variable: whether it is filled in, and whether its shape looks
 * right for what it is meant to be. It prints lengths and prefixes only — never
 * a full secret — so the output is safe to share when asking for help.
 *
 * The shape checks catch the mistake that is easy to make and annoying to
 * diagnose: pasting the publishable key into the secret key slot, or the
 * project URL into the project ref.
 *
 * Run with: npm run check:env
 */

import { loadEnvLocal } from "../tests/load-env.mjs";

if (!loadEnvLocal()) {
  console.error("No .env.local found. Copy .env.example to .env.local first.");
  process.exit(1);
}

const UNFILLED = /^(|YOUR_.*|.*YOUR_PROJECT_REF.*)$/;

/** Shows enough to identify a value, never enough to use it. */
function fingerprint(value) {
  if (value.length <= 12) return `${value.length} chars`;
  return `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`;
}

const checks = [
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    line: 5,
    what: "Project URL",
    where: "Project Settings → API (Data API / Project URL)",
    valid: (v) => /^https:\/\/[a-z0-9-]{8,}\.supabase\.co\/?$/.test(v),
    hint: "should look like https://abcdefghijklmnop.supabase.co",
    secret: false,
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    line: 6,
    what: "Publishable / anon key",
    where: "Project Settings → API Keys → Publishable key",
    valid: (v) => v.startsWith("sb_publishable_") || v.startsWith("eyJ"),
    hint: "starts with sb_publishable_ (new) or eyJ (legacy anon JWT)",
    secret: false,
    mustNotBe: (v) => v.startsWith("sb_secret_"),
    mustNotBeWhy: "this is a SECRET key — it belongs on line 10, not line 6",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    line: 10,
    what: "Secret / service_role key",
    where: "Project Settings → API Keys → Secret keys (reveal)",
    valid: (v) => v.startsWith("sb_secret_") || v.startsWith("eyJ"),
    hint: "starts with sb_secret_ (new) or eyJ (legacy service_role JWT)",
    secret: true,
    mustNotBe: (v) => v.startsWith("sb_publishable_"),
    mustNotBeWhy: "this is the PUBLISHABLE key — it belongs on line 6, not line 10",
  },
  {
    key: "SUPABASE_PROJECT_REF",
    line: 15,
    what: "Project ref",
    where: "the subdomain of your project URL",
    valid: (v) => /^[a-z0-9]{15,}$/.test(v),
    hint: "just the subdomain, e.g. abcdefghijklmnop — no https://, no .supabase.co",
    secret: false,
  },
  {
    key: "SUPABASE_DB_PASSWORD",
    line: 16,
    what: "Database password",
    where: "set when you created the project (resettable under Settings → Database)",
    valid: (v) => v.length >= 8,
    hint: "at least 8 characters",
    secret: true,
  },
  {
    key: "SUPABASE_ACCESS_TOKEN",
    line: 19,
    what: "Personal access token",
    where: "https://supabase.com/dashboard/account/tokens",
    valid: (v) => v.startsWith("sbp_"),
    hint: "starts with sbp_",
    secret: true,
  },
];

let problems = 0;
console.log("Checking .env.local — values are never printed in full.\n");

for (const c of checks) {
  const value = (process.env[c.key] ?? "").trim();
  const label = `line ${String(c.line).padStart(2)}  ${c.key}`;

  if (UNFILLED.test(value)) {
    console.log(`  [ ] ${label}\n        still a placeholder — ${c.what}`);
    console.log(`        from: ${c.where}`);
    problems++;
    continue;
  }

  if (c.mustNotBe?.(value)) {
    console.log(`  [!] ${label}\n        WRONG VALUE — ${c.mustNotBeWhy}`);
    problems++;
    continue;
  }

  if (!c.valid(value)) {
    console.log(`  [?] ${label}  ${c.secret ? "(secret)" : fingerprint(value)}`);
    console.log(`        shape looks wrong — ${c.hint}`);
    problems++;
    continue;
  }

  console.log(`  [x] ${label}  ${c.secret ? "set (secret, not shown)" : fingerprint(value)}`);
}

// Cross-check: the ref in the URL must match SUPABASE_PROJECT_REF, or the CLI
// and the app would talk to two different projects.
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const ref = (process.env.SUPABASE_PROJECT_REF ?? "").trim();
const urlRef = /^https:\/\/([a-z0-9-]+)\.supabase\.co/.exec(url)?.[1];

if (urlRef && ref && !UNFILLED.test(ref) && urlRef !== ref) {
  console.log(
    `\n  [!] mismatch: the URL points at "${urlRef}" but SUPABASE_PROJECT_REF is "${ref}".` +
      `\n      These must be the same project.`,
  );
  problems++;
}

console.log(
  problems === 0
    ? "\nAll six values look right. Ready to link and push migrations."
    : `\n${problems} item(s) still need attention.`,
);

process.exit(problems === 0 ? 0 : 1);
