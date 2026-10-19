/**
 * Schema parity report: what is actually deployed on the hosted project.
 *
 * The local harness (scripts/verify-migrations.mjs) reports 60 tables, 131
 * policies and 26 app.* functions. This asks the real project the same
 * questions, so a drift between the two is visible rather than assumed. The
 * harness shims auth.users and storage.*, so parity here is the only evidence
 * that the migrations produce the same shape on Supabase.
 *
 * Uses the Management API's query endpoint with SUPABASE_ACCESS_TOKEN, which is
 * the same path the dashboard SQL editor takes. Read-only queries only.
 *
 * Run with: npm run report:remote-schema
 */

import { loadEnvLocal } from "../tests/load-env.mjs";

if (!loadEnvLocal()) {
  console.error("No .env.local found.");
  process.exit(1);
}

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!ref || !token || token.startsWith("YOUR_")) {
  console.error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN must be set in .env.local");
  process.exit(1);
}

/** Runs a read-only query via the Management API. Never logs the token. */
async function query(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql, read_only: true }),
    },
  );

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

const QUERIES = {
  "tables in public": `
    select count(*)::int as n from pg_tables where schemaname = 'public'`,

  "RLS policies": `
    select count(*)::int as n from pg_policies where schemaname = 'public'`,

  "app.* functions": `
    select count(*)::int as n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app'`,

  "audit triggers": `
    select count(*)::int as n from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'audit_row_change' and not t.tgisinternal`,

  "exclusion constraints": `
    select count(*)::int as n from pg_constraint where contype = 'x'`,
};

console.log(`Schema report for project ${ref}\n`);

for (const [label, sql] of Object.entries(QUERIES)) {
  const rows = await query(sql);
  console.log(`  ${label.padEnd(24)} ${rows[0].n}`);
}

// Tables with RLS enabled but no policy: intentional for the service-role-only
// tables, a mistake anywhere else. Listed so the distinction stays deliberate.
const noPolicy = await query(`
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity
    and not exists (
      select 1 from pg_policy p where p.polrelid = c.oid
    )
  order by c.relname
`);

console.log(`\n  RLS enabled, no policy (deny-all): ${noPolicy.length}`);
for (const r of noPolicy) console.log(`    - ${r.relname}`);

// Any public table WITHOUT RLS would be a hole. Expect zero.
const noRls = await query(`
  select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  order by c.relname
`);

console.log(`\n  Public tables WITHOUT RLS: ${noRls.length}${noRls.length ? "  <-- PROBLEM" : "  (correct)"}`);
for (const r of noRls) console.log(`    - ${r.relname}`);

// Privileges granted to anon. Expect none on any table.
const anonGrants = await query(`
  select table_name, privilege_type
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
  order by table_name
`);

console.log(
  `\n  Table privileges granted to anon: ${anonGrants.length}${anonGrants.length ? "  <-- PROBLEM" : "  (correct)"}`,
);
for (const g of anonGrants.slice(0, 20)) {
  console.log(`    - ${g.table_name}: ${g.privilege_type}`);
}

// Functions anon may execute. Expect exactly get_public_card.
//
// The timerange/timemultirange constructors that CREATE TYPE ... AS RANGE
// generates are excluded: they build a range value from two `time` inputs,
// touch no data, and cannot be revoked without dropping the type. Counting
// them as findings would bury the one row that matters.
const anonFns = await query(`
  select n.nspname || '.' || p.proname as fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app')
    and p.prokind = 'f'
    and p.proname not in ('timerange', 'timemultirange')
    and has_function_privilege('anon', p.oid, 'EXECUTE')
  order by 1
`);

const EXPECTED_ANON = ["public.get_public_card"];
const unexpected = anonFns.filter((f) => !EXPECTED_ANON.includes(f.fn));

console.log(
  `\n  Functions anon may execute: ${anonFns.length}` +
    (unexpected.length ? "  <-- PROBLEM" : "  (correct)"),
);
for (const f of anonFns) {
  console.log(`    - ${f.fn}${unexpected.includes(f) ? "   UNEXPECTED" : ""}`);
}

// Trigger and internal functions must be callable by no interactive role.
const internalExposed = await query(`
  select n.nspname || '.' || p.proname as fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.prokind = 'f'
    and (p.proname like 'enforce%' or p.proname like '%sync%'
         or p.proname in ('audit_row_change', 'audit_skip_columns',
                          'touch_updated_at', 'recalc_fee_charge'))
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  order by 1
`);

console.log(
  "\n  Trigger/internal functions reachable by anon or authenticated: " +
    `${internalExposed.length}` +
    (internalExposed.length ? "  <-- PROBLEM" : "  (correct)"),
);
for (const f of internalExposed) console.log(`    - ${f.fn}`);
