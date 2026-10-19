// Applies the shim and every migration to a throwaway in-process Postgres and
// reports the first failure with its file name. Run with: node scripts/verify-migrations.mjs
import { freshDatabase, migrationFiles } from "../tests/sql/harness.mjs";

const files = await migrationFiles();
console.log(`applying ${files.length} migrations...`);

try {
  const db = await freshDatabase({ quiet: false });
  const { rows } = await db.query(`
    select count(*)::int as tables from pg_tables where schemaname = 'public'
  `);
  const { rows: pol } = await db.query(`
    select count(*)::int as policies from pg_policies where schemaname = 'public'
  `);
  const { rows: fn } = await db.query(`
    select count(*)::int as functions from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app'
  `);
  console.log(`\nOK  tables=${rows[0].tables} policies=${pol[0].policies} app_functions=${fn[0].functions}`);
  await db.close();
} catch (error) {
  console.error(`\nFAILED: ${error.message}`);
  process.exit(1);
}
