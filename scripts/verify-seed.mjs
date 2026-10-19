// Applies migrations then the seed, and prints a row census.
import { freshDatabase } from "../tests/sql/harness.mjs";
import { readFile } from "node:fs/promises";

const db = await freshDatabase();
try {
  await db.exec(await readFile("supabase/seed.sql", "utf8"));
} catch (error) {
  console.error(`SEED FAILED: ${error.message}`);
  process.exit(1);
}

const census = await db.query(`
  select 'classes' t, count(*)::int n from public.classes
  union all select 'sections', count(*) from public.sections
  union all select 'subjects', count(*) from public.subjects
  union all select 'class_subjects', count(*) from public.class_subjects
  union all select 'students', count(*) from public.students
  union all select 'teachers', count(*) from public.teachers
  union all select 'enrollments', count(*) from public.student_enrollments
  union all select 'assignments', count(*) from public.teacher_assignments
  union all select 'routine_periods', count(*) from public.routine_periods
  union all select 'fee_charges', count(*) from public.fee_charges
  union all select 'grade_bands', count(*) from public.grade_bands
  union all select 'audit_logs', count(*) from public.audit_logs
  order by 1
`);
console.log("seed OK");
for (const r of census.rows) console.log(`  ${r.t.padEnd(16)} ${r.n}`);

const sib = await db.query(`
  select phone, count(*)::int n from public.student_contacts
  where is_sms_target group by phone having count(*) > 1
`);
console.log(`shared guardian phones: ${JSON.stringify(sib.rows)}`);
await db.close();
