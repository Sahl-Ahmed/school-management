/**
 * Exam, mark and result tests.
 *
 * The owner confirmed the policy these assert:
 *   * Standard GPA-5 — A+ 80-100 = 5.0 down to F below 33 = 0.0.
 *   * A student must pass EVERY subject to pass the term.
 *
 * The dangerous failures here are a draft mark becoming visible, a published
 * sheet whose total is quietly wrong because a subject was missing, and a
 * teacher entering marks for a subject they do not teach.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDatabase, asUser } from "./sql/harness.mjs";
import { seedWithAccounts, ids } from "./sql/fixtures.mjs";

let db;

const SCALE = "9ab00000-0000-4000-8000-000000000001";
let examId;
let examSubjects;   // subject_id -> exam_subject_id for Class 3
const ROSTER = [
  ids.studentAlpha,
  ids.studentBeta,
  "57000000-0000-4000-8000-000000000005", // Epsilon
];

beforeAll(async () => {
  db = await freshDatabase();
  await seedWithAccounts(db);

  // A second-term exam for Class 3, covering the two subjects the seed
  // actually assigns teachers to.
  const exam = await db.query(
    `insert into public.exams
       (academic_year_id, term_id, name, status, grading_scale_id, starts_on, ends_on)
     values ($1, $2, 'Second Term Exam', 'marks_open', $3, '2026-06-01', '2026-06-10')
     returning id`,
    [ids.academicYear, ids.termSecond, SCALE],
  );
  examId = exam.rows[0].id;

  const subjects = await db.query(
    `insert into public.exam_subjects (exam_id, class_id, subject_id, max_marks, pass_marks)
     values ($1, $2, $3, 100, 33), ($1, $2, $4, 100, 33)
     returning id, subject_id`,
    [examId, ids.classThree, ids.subjectBangla, ids.subjectMaths],
  );

  examSubjects = Object.fromEntries(
    subjects.rows.map((r) => [r.subject_id, r.id]),
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const rpc = (userId, sql, params) =>
  asUser(db, userId, async () => (await db.query(sql, params)).rows[0]);

async function submit(userId, examSubjectId, entries, reason = null) {
  return rpc(userId, "select public.submit_marks($1,$2,$3::jsonb,$4) as r", [
    examSubjectId, ids.sectionThreeA, JSON.stringify(entries), reason,
  ]);
}

function marks(values) {
  return ROSTER.map((id, i) => ({ student_id: id, marks: values[i], absent: false }));
}

// ===========================================================================
describe("the grading scale is configuration, not code", () => {
  it("maps percentages to the confirmed GPA-5 bands", async () => {
    const cases = [
      [95, "A+", 5], [80, "A+", 5],
      [79, "A", 4], [70, "A", 4],
      [69, "A-", 3.5], [60, "A-", 3.5],
      [59, "B", 3], [50, "B", 3],
      [49, "C", 2], [40, "C", 2],
      [39, "D", 1], [33, "D", 1],
      [32, "F", 0], [0, "F", 0],
    ];

    for (const [pct, grade, point] of cases) {
      const r = await db.query("select * from app.grade_for($1, $2)", [SCALE, pct]);
      expect(r.rows[0].grade, `${pct}% should be ${grade}`).toBe(grade);
      expect(Number(r.rows[0].grade_point)).toBe(point);
    }
  });

  it("marks only F as a failing band", async () => {
    const fail = await db.query("select * from app.grade_for($1, 20)", [SCALE]);
    const pass = await db.query("select * from app.grade_for($1, 35)", [SCALE]);

    expect(fail.rows[0].is_pass).toBe(false);
    expect(pass.rows[0].is_pass).toBe(true);
  });

  it("defaults to the confirmed pass rule", async () => {
    const r = await db.query(
      "select pass_rule, fail_zeroes_gpa from public.grading_scales where id = $1",
      [SCALE],
    );
    expect(r.rows[0].pass_rule).toBe("all_subjects");
    expect(r.rows[0].fail_zeroes_gpa).toBe(true);
  });
});

// ===========================================================================
describe("who may enter marks", () => {
  it("the assigned teacher can, for their own subject", async () => {
    const { r } = await submit(
      ids.userTeacherOne, examSubjects[ids.subjectBangla], marks([75, 55, 40]),
    );
    expect(r.marked).toBe(3);
    expect(r.correction).toBe(false);
  });

  it("a teacher cannot enter marks for a subject they do not teach", async () => {
    // Teacher One teaches Bangla, not Mathematics.
    await expect(
      submit(ids.userTeacherOne, examSubjects[ids.subjectMaths], marks([60, 60, 60])),
    ).rejects.toThrow(/not assigned to teach that subject/i);
  });

  it("a teacher of another class cannot enter marks", async () => {
    await expect(
      submit(ids.userTeacherThree, examSubjects[ids.subjectBangla], marks([10, 10, 10])),
    ).rejects.toThrow(/not assigned to teach that subject/i);
  });

  it("a student cannot enter marks", async () => {
    await expect(
      submit(ids.userStudentAlpha, examSubjects[ids.subjectBangla], marks([99, 99, 99])),
    ).rejects.toThrow(/not assigned to teach that subject/i);
  });

  it("refuses a mark above the subject maximum", async () => {
    // A reason is supplied because Bangla is already submitted by now; without
    // it the correction guard would fire first and hide what this asserts.
    await expect(
      submit(
        ids.userTeacherOne, examSubjects[ids.subjectBangla],
        marks([101, 50, 50]), "validation check",
      ),
    ).rejects.toThrow(/exceeds max_marks/i);
  });

  it("refuses a student who is neither scored nor marked absent", async () => {
    await expect(
      submit(
        ids.userTeacherOne, examSubjects[ids.subjectBangla],
        [{ student_id: ROSTER[0], marks: null, absent: false }],
        "validation check",
      ),
    ).rejects.toThrow(/needs a score or an absence/i);
  });

  it("refuses a student marked both absent and scored", async () => {
    await expect(
      submit(
        ids.userTeacherOne, examSubjects[ids.subjectBangla],
        [{ student_id: ROSTER[0], marks: 50, absent: true }],
        "validation check",
      ),
    ).rejects.toThrow(/absent cannot also have a score/i);
  });

  it("refuses a student not enrolled in the section", async () => {
    await expect(
      submit(
        ids.userTeacherOne, examSubjects[ids.subjectBangla],
        [{ student_id: ids.siblingElder, marks: 50, absent: false }],
        "validation check",
      ),
    ).rejects.toThrow(/not enrolled in this section/i);
  });

  it("requires a reason to change submitted marks", async () => {
    await expect(
      submit(ids.userTeacherOne, examSubjects[ids.subjectBangla], marks([80, 55, 40])),
    ).rejects.toThrow(/requires a reason/i);

    const { r } = await submit(
      ids.userTeacherOne, examSubjects[ids.subjectBangla], marks([80, 55, 40]),
      "Addition error on question 4.",
    );
    expect(r.correction).toBe(true);
  });
});

// ===========================================================================
describe("draft marks stay private", () => {
  it("a student cannot read the marks table", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query("select id from public.marks")).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("a student has no published result before publication", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query("select * from public.student_results($1)", [ids.studentAlpha])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("a student cannot see an exam whose routine is unpublished", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query("select id from public.exams")).rows,
    );
    expect(rows).toHaveLength(0);
  });
});

// ===========================================================================
describe("submission tracking", () => {
  it("shows which subjects are in and which are outstanding", async () => {
    const rows = await asUser(db, ids.userAuthority, async () =>
      (await db.query("select * from public.exam_submission_progress($1)", [examId])).rows,
    );

    const bangla = rows.find((r) => r.subject_name === "Bangla");
    const maths = rows.find((r) => r.subject_name === "Mathematics");

    expect(Number(bangla.roster)).toBe(3);
    expect(Number(bangla.marks_entered)).toBe(3);
    expect(bangla.submitted_at).not.toBeNull();

    // Mathematics has not been submitted yet.
    expect(Number(maths.marks_entered)).toBe(0);
    expect(maths.submitted_at).toBeNull();
  });

  it("is authority-only", async () => {
    const rows = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query("select * from public.exam_submission_progress($1)", [examId])).rows,
    );
    expect(rows).toHaveLength(0);
  });
});

// ===========================================================================
describe("publishing", () => {
  it("refuses while any mark is un-entered", async () => {
    // Mathematics is still outstanding, so the totals would be wrong in a way
    // nobody reading the sheet could see.
    await expect(
      rpc(ids.userAuthority, "select public.publish_results($1) as r", [examId]),
    ).rejects.toThrow(/un-entered/i);
  });

  it("is refused to a teacher and to office staff", async () => {
    for (const user of [ids.userTeacherOne, ids.userOfficeStaff]) {
      await expect(
        rpc(user, "select public.publish_results($1) as r", [examId]),
      ).rejects.toThrow(/only a school administrator/i);
    }
  });

  it("publishes once every subject is in", async () => {
    // Teacher Two owns Mathematics. Alpha fails it deliberately.
    await submit(ids.userTeacherTwo, examSubjects[ids.subjectMaths], [
      { student_id: ROSTER[0], marks: 28, absent: false },  // fail
      { student_id: ROSTER[1], marks: 65, absent: false },
      { student_id: ROSTER[2], marks: 90, absent: false },
    ]);

    const { r } = await rpc(
      ids.userAuthority, "select public.publish_results($1) as r", [examId],
    );

    expect(r.published).toBe(3);
    expect(r.pass_rule).toBe("all_subjects");
  });

  it("computes totals, percentage and grade from the configured scale", async () => {
    const rows = await db.query(
      `select pr.*, s.registration_no
         from public.published_results pr
         join public.students s on s.id = pr.student_id
        where pr.exam_id = $1 order by s.registration_no`,
      [examId],
    );

    const alpha = rows.rows.find((x) => x.registration_no === "STU-2026-0001");
    // Bangla 80 + Maths 28 = 108 of 200 = 54%.
    expect(Number(alpha.total_obtained)).toBe(108);
    expect(Number(alpha.total_max)).toBe(200);
    expect(Number(alpha.percentage)).toBe(54);

    // 54% sits in the B band, but Alpha failed a subject, and the scale zeroes
    // a failed GPA — so the printed overall grade follows the result (F) while
    // the band grade stays in the snapshot. See migration 0032.
    expect(alpha.grade).toBe("F");
    expect(alpha.snapshot.grade_computed).toBe("B");
  });

  it("prints the percentage's band when the student passes", async () => {
    const rows = await db.query(
      `select pr.grade, pr.snapshot, pr.percentage, s.registration_no
         from public.published_results pr
         join public.students s on s.id = pr.student_id
        where pr.exam_id = $1 and pr.is_pass`,
      [examId],
    );

    expect(rows.rows.length, "at least one student passed").toBeGreaterThan(0);

    for (const row of rows.rows) {
      // A pass is unaffected by the failure convention: printed and computed
      // agree, so no sheet shows a grade its percentage does not justify.
      expect(row.grade).toBe(row.snapshot.grade_computed);
    }
  });

  it("fails a student who fails one subject, per the confirmed rule", async () => {
    const rows = await db.query(
      `select pr.is_pass, pr.gpa, pr.snapshot, s.registration_no
         from public.published_results pr
         join public.students s on s.id = pr.student_id
        where pr.exam_id = $1`,
      [examId],
    );

    const alpha = rows.rows.find((x) => x.registration_no === "STU-2026-0001");
    const beta = rows.rows.find((x) => x.registration_no === "STU-2026-0002");

    // Alpha passed Bangla (80, A+) but failed Maths (28, F) — overall FAIL,
    // even though the average is a comfortable 54%.
    expect(alpha.is_pass).toBe(false);
    expect(alpha.snapshot.failed_subjects).toBe(1);

    // And the Bangladeshi convention: GPA prints 0.00 on a fail, with the
    // computed average retained in the snapshot so nothing is lost.
    expect(Number(alpha.gpa)).toBe(0);
    expect(Number(alpha.snapshot.gpa_computed)).toBe(2.5); // (5.0 + 0.0) / 2

    // Beta passed both (55 = B = 3.0, 65 = A- = 3.5).
    expect(beta.is_pass).toBe(true);
    expect(Number(beta.gpa)).toBe(3.25);
  });

  it("records every subject with earned and maximum marks", async () => {
    const row = await db.query(
      `select pr.snapshot from public.published_results pr
         join public.students s on s.id = pr.student_id
        where pr.exam_id = $1 and s.registration_no = 'STU-2026-0001'`,
      [examId],
    );

    const subjects = row.rows[0].snapshot.subjects;
    expect(subjects).toHaveLength(2);

    const bangla = subjects.find((s) => s.subject === "Bangla");
    expect(Number(bangla.obtained)).toBe(80);
    expect(Number(bangla.max)).toBe(100);
    expect(bangla.grade).toBe("A+");
    expect(bangla.passed).toBe(true);

    const maths = subjects.find((s) => s.subject === "Mathematics");
    expect(maths.grade).toBe("F");
    expect(maths.passed).toBe(false);
  });

  it("assigns class positions by percentage", async () => {
    const rows = await db.query(
      `select pr.position_in_class, pr.percentage, s.registration_no
         from public.published_results pr
         join public.students s on s.id = pr.student_id
        where pr.exam_id = $1 order by pr.position_in_class`,
      [examId],
    );

    // Epsilon: 40 + 90 = 130 (65%). Beta: 55 + 65 = 120 (60%). Alpha: 54%.
    expect(rows.rows[0].registration_no).toBe("STU-2026-0005");
    expect(rows.rows[0].position_in_class).toBe(1);
    expect(rows.rows[2].registration_no).toBe("STU-2026-0001");
    expect(rows.rows[2].position_in_class).toBe(3);
  });

  it("cannot be published twice", async () => {
    await expect(
      rpc(ids.userAuthority, "select public.publish_results($1) as r", [examId]),
    ).rejects.toThrow(/already published/i);
  });

  it("closes mark entry once published", async () => {
    const exam = await db.query("select status from public.exams where id = $1", [examId]);
    expect(exam.rows[0].status).toBe("published");

    // A teacher can no longer change a mark behind a published sheet.
    await expect(
      submit(ids.userTeacherOne, examSubjects[ids.subjectBangla], marks([90, 90, 90]), "late change"),
    ).rejects.toThrow(/not open/i);
  });

  it("freezes the sheet, so a later mark correction does not rewrite it", async () => {
    const before = await db.query(
      `select total_obtained from public.published_results
        where exam_id = $1 and student_id = $2`,
      [examId, ids.studentAlpha],
    );

    // The authority may still correct the underlying mark.
    await db.query(
      `update public.marks set marks_obtained = 95
        where exam_subject_id = $1 and student_id = $2`,
      [examSubjects[ids.subjectBangla], ids.studentAlpha],
    );

    const after = await db.query(
      `select total_obtained from public.published_results
        where exam_id = $1 and student_id = $2`,
      [examId, ids.studentAlpha],
    );

    // The published sheet is unchanged — the parent's copy still matches.
    expect(Number(after.rows[0].total_obtained)).toBe(Number(before.rows[0].total_obtained));
  });
});

// ===========================================================================
describe("who may read a published result", () => {
  it("the student can read their own", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query("select * from public.student_results($1)", [ids.studentAlpha])).rows,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].exam_name).toBe("Second Term Exam");
    expect(rows[0].is_pass).toBe(false);
  });

  it("a student cannot read another student's result", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query("select * from public.student_results($1)", [ids.studentBeta])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("a teacher can read a result for a student they teach", async () => {
    const rows = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query("select * from public.student_results($1)", [ids.studentAlpha])).rows,
    );
    expect(rows).toHaveLength(1);
  });

  it("a teacher cannot read a result for a student they do not teach", async () => {
    const rows = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query("select * from public.student_results($1)", [ids.siblingElder])).rows,
    );
    expect(rows).toHaveLength(0);
  });
});

// ===========================================================================
describe("extra class tests", () => {
  let testId;

  beforeAll(async () => {
    const t = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query(
        `insert into public.class_tests
           (academic_year_id, class_id, section_id, subject_id, teacher_id,
            name, max_marks, test_date)
         values ($1,$2,$3,$4,$5,'Weekly Bangla Test',20,'2026-06-15')
         returning id`,
        [ids.academicYear, ids.classThree, ids.sectionThreeA,
         ids.subjectBangla, ids.teacherOne],
      )).rows[0],
    );
    testId = t.id;
  });

  it("a teacher can create a test for their own assigned subject", async () => {
    expect(testId).toBeTruthy();
  });

  it("a teacher cannot create a test for a subject they do not teach", async () => {
    await expect(
      asUser(db, ids.userTeacherOne, async () =>
        db.query(
          `insert into public.class_tests
             (academic_year_id, class_id, section_id, subject_id, teacher_id,
              name, max_marks, test_date)
           values ($1,$2,$3,$4,$5,'Sneaky Maths Test',20,'2026-06-15')`,
          [ids.academicYear, ids.classThree, ids.sectionThreeA,
           ids.subjectMaths, ids.teacherOne],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("refuses to send results before marks are entered", async () => {
    await expect(
      rpc(ids.userTeacherOne, "select public.send_class_test_result($1) as r", [testId]),
    ).rejects.toThrow(/enter marks before sending/i);
  });

  it("sends once marks exist", async () => {
    await asUser(db, ids.userTeacherOne, async () =>
      db.query(
        `insert into public.class_test_marks (class_test_id, student_id, marks_obtained)
         values ($1,$2,18),($1,$3,15),($1,$4,11)`,
        [testId, ROSTER[0], ROSTER[1], ROSTER[2]],
      ),
    );

    const { r } = await rpc(
      ids.userTeacherOne, "select public.send_class_test_result($1) as r", [testId],
    );
    expect(r.students).toBe(3);
  });

  it("cannot send twice, however many times the button is clicked", async () => {
    await expect(
      rpc(ids.userTeacherOne, "select public.send_class_test_result($1) as r", [testId]),
    ).rejects.toThrow(/already sent/i);
  });

  it("a student sees the test only once the result has been sent", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query("select id, name from public.class_tests")).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Weekly Bangla Test");
  });

  it("another teacher cannot send someone else's test", async () => {
    const other = await asUser(db, ids.userTeacherTwo, async () =>
      (await db.query(
        `insert into public.class_tests
           (academic_year_id, class_id, section_id, subject_id, teacher_id,
            name, max_marks, test_date)
         values ($1,$2,$3,$4,$5,'Maths Test',20,'2026-06-16')
         returning id`,
        [ids.academicYear, ids.classThree, ids.sectionThreeA,
         ids.subjectMaths, ids.teacherTwo],
      )).rows[0],
    );

    await expect(
      rpc(ids.userTeacherOne, "select public.send_class_test_result($1) as r", [other.id]),
    ).rejects.toThrow(/belongs to another teacher/i);
  });
});
