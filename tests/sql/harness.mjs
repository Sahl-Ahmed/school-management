/**
 * SQL test harness.
 *
 * Boots an in-process Postgres (PGlite), applies the Supabase shim and then
 * every migration in order, and hands back a database the tests can act on as
 * a specific user and role.
 *
 * Why this exists: the access rules the brief cares about — a student cannot
 * read a sibling's record, a teacher cannot see unrelated classes, a public QR
 * scan reveals only card fields — are enforced by RLS policies. Testing them
 * through the application would test the application's queries, not the
 * policies. Here the policies are exercised directly.
 *
 * Fidelity caveats, which matter when reading a passing test:
 *   * auth.users and storage.* are shims (tests/sql/supabase-shim.sql), not the
 *     real platform tables.
 *   * `becomeUser` does `set role authenticated` plus a JWT claim, which is
 *     what PostgREST does per request. RLS therefore applies for real.
 *   * PGlite is single-connection, so these tests say nothing about behaviour
 *     under concurrency.
 */

import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");
const migrationsDir = join(projectRoot, "supabase", "migrations");
const shimPath = join(here, "supabase-shim.sql");

/** Reads the migration files in the order Supabase would apply them. */
export async function migrationFiles() {
  const entries = await readdir(migrationsDir);
  return entries.filter((f) => f.endsWith(".sql")).sort();
}

/**
 * Creates a fresh database with the shim and all migrations applied.
 * Throws with the offending file and statement if a migration fails.
 */
export async function freshDatabase({ quiet = true } = {}) {
  const db = await PGlite.create({ extensions: { btree_gist, pgcrypto, pg_trgm } });

  await db.exec(await readFile(shimPath, "utf8"));

  for (const file of await migrationFiles()) {
    const sql = await readFile(join(migrationsDir, file), "utf8");
    try {
      await db.exec(sql);
      if (!quiet) console.log(`  applied ${file}`);
    } catch (error) {
      throw new Error(`migration ${file} failed: ${error.message}`, { cause: error });
    }
  }

  return db;
}

/**
 * Runs `fn` as a signed-in user: role `authenticated`, with auth.uid()
 * resolving to `userId`. Resets to the owner role afterwards even on failure,
 * so one failing test cannot leave the connection impersonating someone.
 */
export async function asUser(db, userId, fn) {
  await db.exec(`
    set role authenticated;
    select set_config('request.jwt.claims',
      json_build_object('sub', '${userId}', 'role', 'authenticated')::text, false);
  `);
  try {
    return await fn();
  } finally {
    await db.exec(`
      reset role;
      select set_config('request.jwt.claims', '', false);
    `);
  }
}

/** Runs `fn` as an anonymous visitor: role `anon`, no JWT subject. */
export async function asAnon(db, fn) {
  await db.exec(`
    set role anon;
    select set_config('request.jwt.claims',
      json_build_object('role', 'anon')::text, false);
  `);
  try {
    return await fn();
  } finally {
    await db.exec(`
      reset role;
      select set_config('request.jwt.claims', '', false);
    `);
  }
}

/**
 * Asserts a query is rejected. Returns the error so a test can check which
 * kind of refusal it was — a policy denial and a missing table are both
 * "it failed", and conflating them hides broken tests.
 */
export async function expectRejected(promiseFactory) {
  try {
    await promiseFactory();
  } catch (error) {
    return error;
  }
  throw new Error("expected the query to be rejected, but it succeeded");
}
