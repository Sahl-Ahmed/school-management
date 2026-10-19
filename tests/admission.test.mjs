/**
 * Admission RPC tests, against a local Postgres.
 *
 * These cover the rules that make admission safe rather than merely working:
 * who may admit, what the atomic insert guarantees, and the sibling case the
 * brief singles out. Photo upload and storage policies are not testable here —
 * the harness shims storage — so those are verified against the hosted project
 * in tests/remote-access.test.ts instead.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { freshDatabase, asUser } from "./sql/harness.mjs";
import { seedWithAccounts, ids } from "./sql/fixtures.mjs";
import { randomUUID } from "node:crypto";

let db;

beforeAll(async () => {
  db = await freshDatabase();
  await seedWithAccounts(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** A complete, valid admission payload with overridable fields. */
function payload(overrides = {}) {
  const id = randomUUID();
  return {
    id,
    auth_user_id: null,
    registration_no: `STU-TEST-${id.slice(0, 8)}`,
    full_name: "Test Student",
    gender: "male",
    date_of_birth: "2015-01-01",
    blood_group: "B+",
    father_name: "Test Father",
    mother_name: "Test Mother",
    guardian_phone: "+8801300009001",
    academic_year_id: ids.academicYear,
    section_id: ids.sectionThreeA,
    roll_no: 900,
    father_nid: "1234567890",
    mother_nid: null,
    birth_certificate_no: null,
    admitted_on: null,
    ...overrides,
  };
}

async function admit(userId, body) {
  return asUser(db, userId, async () =>
    db.query("select public.create_student_record($1::jsonb) as id", [
      JSON.stringify(body),
    ]),
  );
}

let rollCounter = 900;
beforeEach(() => {
  rollCounter += 1;
});

describe("who may admit a student", () => {
  it("an authority admin can", async () => {
    const body = payload({ roll_no: rollCounter });
    const result = await admit(ids.userAuthority, body);

    expect(result.rows[0].id).toBe(body.id);
  });

  it("office staff can", async () => {
    const body = payload({ roll_no: rollCounter });
    const result = await admit(ids.userOfficeStaff, body);

    expect(result.rows[0].id).toBe(body.id);
  });

  it("a teacher cannot", async () => {
    await expect(admit(ids.userTeacherOne, payload({ roll_no: rollCounter })))
      .rejects.toThrow(/only the school authority/i);
  });

  it("a student cannot", async () => {
    await expect(admit(ids.userStudentAlpha, payload({ roll_no: rollCounter })))
      .rejects.toThrow(/only the school authority/i);
  });
});

describe("the admission is atomic", () => {
  it("writes all four tables in one call", async () => {
    const body = payload({ roll_no: rollCounter });
    await admit(ids.userAuthority, body);

    const rows = await db.query(
      `select
         (select count(*) from public.students where id = $1)::int as student,
         (select count(*) from public.student_private_ids where student_id = $1)::int as ids,
         (select count(*) from public.student_contacts where student_id = $1)::int as contacts,
         (select count(*) from public.student_enrollments where student_id = $1)::int as enrollment`,
      [body.id],
    );

    expect(rows.rows[0]).toEqual({ student: 1, ids: 1, contacts: 1, enrollment: 1 });
  });

  it("leaves nothing behind when a constraint fails", async () => {
    // No parent NID violates a CHECK on student_private_ids, which is the
    // SECOND insert. If the function were not atomic, the students row from the
    // first insert would survive.
    const body = payload({
      roll_no: rollCounter,
      father_nid: null,
      mother_nid: null,
    });

    await expect(admit(ids.userAuthority, body)).rejects.toThrow();

    const leftovers = await db.query(
      "select count(*)::int as n from public.students where id = $1",
      [body.id],
    );
    expect(leftovers.rows[0].n).toBe(0);
  });

  it("rolls back the student row when the enrollment fails", async () => {
    // Duplicate roll number in the same section and year: the LAST insert.
    const first = payload({ roll_no: 7001 });
    await admit(ids.userAuthority, first);

    const second = payload({ roll_no: 7001 });
    await expect(admit(ids.userAuthority, second)).rejects.toThrow(/roll_no|unique|duplicate/i);

    const leftovers = await db.query(
      `select
         (select count(*) from public.students where id = $1)::int as student,
         (select count(*) from public.student_contacts where student_id = $1)::int as contacts`,
      [second.id],
    );
    expect(leftovers.rows[0]).toEqual({ student: 0, contacts: 0 });
  });

  it("derives the class from the section rather than trusting the payload", async () => {
    const body = payload({ roll_no: rollCounter, section_id: ids.sectionEightA });
    await admit(ids.userAuthority, body);

    const row = await db.query(
      `select e.class_id, s.class_id as section_class
         from public.student_enrollments e
         join public.sections s on s.id = e.section_id
        where e.student_id = $1`,
      [body.id],
    );

    expect(row.rows[0].class_id).toBe(row.rows[0].section_class);
    expect(row.rows[0].class_id).toBe(ids.classEight);
  });

  it("refuses an unknown section", async () => {
    await expect(
      admit(ids.userAuthority, payload({ roll_no: rollCounter, section_id: randomUUID() })),
    ).rejects.toThrow(/unknown section/i);
  });
});

describe("registration numbers", () => {
  it("must be unique, case-insensitively", async () => {
    const body = payload({ roll_no: rollCounter, registration_no: "STU-CASE-0001" });
    await admit(ids.userAuthority, body);

    await expect(
      admit(
        ids.userAuthority,
        payload({ roll_no: rollCounter + 50, registration_no: "stu-case-0001" }),
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("siblings sharing one guardian phone", () => {
  it("two students can be admitted on the same number with separate accounts", async () => {
    const sharedPhone = "+8801300009123";

    // Two auth identities, as the server action would create.
    const elderUser = randomUUID();
    const youngerUser = randomUUID();
    await db.exec(`
      insert into auth.users (id, email) values
        ('${elderUser}',   'sib-elder-${elderUser.slice(0, 8)}@students.school.invalid'),
        ('${youngerUser}', 'sib-young-${youngerUser.slice(0, 8)}@students.school.invalid');
      insert into public.profiles (id, role, full_name) values
        ('${elderUser}',   'student', 'Sibling Elder Test'),
        ('${youngerUser}', 'student', 'Sibling Younger Test');
    `);

    const elder = payload({
      roll_no: 8101,
      full_name: "Sibling Elder Test",
      guardian_phone: sharedPhone,
      auth_user_id: elderUser,
      section_id: ids.sectionEightA,
    });
    const younger = payload({
      roll_no: 8102,
      full_name: "Sibling Younger Test",
      guardian_phone: sharedPhone,
      auth_user_id: youngerUser,
      section_id: ids.sectionThreeA,
    });

    await admit(ids.userAuthority, elder);
    await admit(ids.userAuthority, younger);

    const shared = await db.query(
      `select count(*)::int as n from public.student_contacts
        where phone = $1 and is_sms_target`,
      [sharedPhone],
    );
    expect(shared.rows[0].n).toBe(2);

    // Separate identities, separate registration numbers.
    const accounts = await db.query(
      `select id, registration_no, auth_user_id from public.students
        where id in ($1, $2) order by registration_no`,
      [elder.id, younger.id],
    );
    expect(accounts.rows).toHaveLength(2);
    expect(accounts.rows[0].auth_user_id).not.toBe(accounts.rows[1].auth_user_id);
    expect(accounts.rows[0].registration_no).not.toBe(accounts.rows[1].registration_no);

    // And each sees only their own record.
    const elderView = await asUser(db, elderUser, async () =>
      (await db.query("select id from public.students")).rows,
    );
    const youngerView = await asUser(db, youngerUser, async () =>
      (await db.query("select id from public.students")).rows,
    );

    expect(elderView).toEqual([{ id: elder.id }]);
    expect(youngerView).toEqual([{ id: younger.id }]);
  });

  it("one student cannot hold two SMS target contacts", async () => {
    const body = payload({ roll_no: rollCounter });
    await admit(ids.userAuthority, body);

    await expect(
      db.query(
        `insert into public.student_contacts (student_id, label, phone, is_sms_target)
         values ($1, 'emergency', '+8801300009777', true)`,
        [body.id],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("teacher creation", () => {
  function teacherPayload(overrides = {}) {
    const id = randomUUID();
    return {
      id,
      auth_user_id: null,
      employee_code: `T-TEST-${id.slice(0, 6)}`,
      full_name: "Test Teacher",
      gender: "female",
      personal_phone: "+8801300008001",
      nid: "9876543210",
      assignments: [],
      ...overrides,
    };
  }

  async function createTeacher(userId, body) {
    return asUser(db, userId, async () =>
      db.query("select public.create_teacher_record($1::jsonb) as id", [
        JSON.stringify(body),
      ]),
    );
  }

  it("an authority can create a teacher with assignments", async () => {
    const body = teacherPayload({
      assignments: [
        {
          section_id: ids.sectionThreeA,
          subject_id: "50b00000-0000-4000-8000-000000000004", // Science
          academic_year_id: ids.academicYear,
          effective_from: "2026-01-01",
        },
      ],
    });

    const result = await createTeacher(ids.userAuthority, body);
    expect(result.rows[0].id).toBe(body.id);

    const assignments = await db.query(
      "select count(*)::int as n from public.teacher_assignments where teacher_id = $1",
      [body.id],
    );
    expect(assignments.rows[0].n).toBe(1);
  });

  it("a teacher cannot create another teacher", async () => {
    await expect(createTeacher(ids.userTeacherOne, teacherPayload()))
      .rejects.toThrow(/only the school authority/i);
  });

  it("refuses an assignment that clashes with an existing teacher", async () => {
    // Teacher One already holds Bangla for Class 3 from 2026-01-01 with no end.
    const body = teacherPayload({
      assignments: [
        {
          section_id: ids.sectionThreeA,
          subject_id: ids.subjectBangla,
          academic_year_id: ids.academicYear,
          effective_from: "2026-06-01",
        },
      ],
    });

    await expect(createTeacher(ids.userAuthority, body))
      .rejects.toThrow(/overlap|exclusion|conflicting/i);

    const leftovers = await db.query(
      "select count(*)::int as n from public.teachers where id = $1",
      [body.id],
    );
    expect(leftovers.rows[0].n).toBe(0);
  });

  it("records a device mapping without storing any fingerprint", async () => {
    const body = teacherPayload({
      device_id: "de000000-0000-4000-8000-000000000001",
      device_user_id: "501",
      enrolled_fingers: 3,
    });

    await createTeacher(ids.userAuthority, body);

    const mapping = await db.query(
      `select device_user_id, enrolled_fingers, enrolled_at is not null as stamped
         from public.device_users where teacher_id = $1`,
      [body.id],
    );

    expect(mapping.rows[0].device_user_id).toBe("501");
    expect(mapping.rows[0].enrolled_fingers).toBe(3);
    expect(mapping.rows[0].stamped).toBe(true);

    // No biometric template is stored anywhere. Checked two ways, because the
    // brief is explicit that templates stay on the terminal.
    //
    // 1. No column is named for one. `%template%` alone would match
    //    generated_documents.template_id and qr_tokens.template_id, which are
    //    document-template references, so the pattern is narrowed to names that
    //    could only mean biometrics.
    const named = await db.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and (column_name ilike '%fingerprint%'
          or column_name ilike '%biometric%'
          or column_name ilike '%minutiae%'
          or column_name ilike '%finger_template%')
    `);
    expect(named.rows).toHaveLength(0);

    // 2. The device tables hold no binary column at all, so there is nowhere a
    //    template could be put even without a telling name.
    const binary = await db.query(`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('device_users', 'devices', 'raw_punch_events')
        and data_type in ('bytea', 'USER-DEFINED')
    `);
    expect(binary.rows.filter((r) => r.data_type === "bytea")).toHaveLength(0);
  });
});
