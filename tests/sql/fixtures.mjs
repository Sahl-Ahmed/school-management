/**
 * Shared test fixtures: the seed plus signed-in accounts wired to it.
 *
 * supabase/seed.sql deliberately creates no auth users, because identities
 * belong to Supabase Auth rather than to SQL. The tests need users, so this
 * file adds them against the shimmed auth.users table and links them to the
 * seeded students and teachers.
 */

import { readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Fixed ids so tests can refer to a specific person. */
export const ids = {
  academicYear: "a0000000-0000-4000-8000-000000000001",
  termSecond: "17000000-0000-4000-8000-000000000002",

  classThree: "c1000000-0000-4000-8000-000000000005",
  classEight: "c1000000-0000-4000-8000-00000000000a",
  sectionThreeA: "5ec00000-0000-4000-8000-000000000005",
  sectionEightA: "5ec00000-0000-4000-8000-000000000010",

  subjectBangla: "50b00000-0000-4000-8000-000000000001",
  subjectEnglish: "50b00000-0000-4000-8000-000000000002",
  subjectMaths: "50b00000-0000-4000-8000-000000000003",

  // Teacher One: Bangla, Class 3 only.
  teacherOne: "7eac0000-0000-4000-8000-000000000001",
  // Teacher Three: English, Class 8 only.
  teacherThree: "7eac0000-0000-4000-8000-000000000003",

  studentAlpha: "57000000-0000-4000-8000-000000000001",
  studentBeta: "57000000-0000-4000-8000-000000000002",
  siblingElder: "57000000-0000-4000-8000-000000000003",   // Class 8
  siblingYounger: "57000000-0000-4000-8000-000000000004", // Class 1

  // Auth identities.
  userAuthority: "0a000000-0000-4000-8000-000000000001",
  userOfficeStaff: "0a000000-0000-4000-8000-000000000002",
  userTeacherOne: "0b000000-0000-4000-8000-000000000001",
  userTeacherThree: "0b000000-0000-4000-8000-000000000003",
  userStudentAlpha: "0c000000-0000-4000-8000-000000000001",
  userSiblingElder: "0c000000-0000-4000-8000-000000000003",
  userSiblingYounger: "0c000000-0000-4000-8000-000000000004",
};

/** Applies supabase/seed.sql and provisions linked accounts. */
export async function seedWithAccounts(db) {
  await db.exec(await readFile(join(projectRoot, "supabase", "seed.sql"), "utf8"));

  await db.exec(`
    insert into auth.users (id, email) values
      ('${ids.userAuthority}',      'authority@school.example'),
      ('${ids.userOfficeStaff}',    'office@school.example'),
      ('${ids.userTeacherOne}',     't001@teachers.school.invalid'),
      ('${ids.userTeacherThree}',   't003@teachers.school.invalid'),
      ('${ids.userStudentAlpha}',   's0001@students.school.invalid'),
      ('${ids.userSiblingElder}',   's0003@students.school.invalid'),
      ('${ids.userSiblingYounger}', 's0004@students.school.invalid');

    insert into public.profiles (id, role, full_name, must_set_password, activated_at) values
      ('${ids.userAuthority}',      'authority_admin', 'Demo Authority Admin', false, now()),
      ('${ids.userOfficeStaff}',    'authority_staff', 'Demo Office Staff',    false, now()),
      ('${ids.userTeacherOne}',     'teacher',         'Demo Teacher One',     false, now()),
      ('${ids.userTeacherThree}',   'teacher',         'Demo Teacher Three',   false, now()),
      ('${ids.userStudentAlpha}',   'student',         'Demo Student Alpha',   false, now()),
      ('${ids.userSiblingElder}',   'student',         'Demo Sibling Elder',   false, now()),
      ('${ids.userSiblingYounger}', 'student',         'Demo Sibling Younger', false, now());

    update public.teachers set auth_user_id = '${ids.userTeacherOne}'
      where id = '${ids.teacherOne}';
    update public.teachers set auth_user_id = '${ids.userTeacherThree}'
      where id = '${ids.teacherThree}';

    update public.students set auth_user_id = '${ids.userStudentAlpha}'
      where id = '${ids.studentAlpha}';
    update public.students set auth_user_id = '${ids.userSiblingElder}'
      where id = '${ids.siblingElder}';
    update public.students set auth_user_id = '${ids.userSiblingYounger}'
      where id = '${ids.siblingYounger}';
  `);
}
