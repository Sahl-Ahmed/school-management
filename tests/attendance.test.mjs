/**
 * Routine and attendance tests.
 *
 * The central thing under test is the invariant the whole module exists for:
 *
 *   "the teacher has not submitted" is NOT "the student was absent",
 *   and percentages are computed from SUBMITTED lessons only.
 *
 * Everything else here — clash prevention, who may submit, holiday and
 * cancellation handling — protects that invariant or the routine it depends on.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDatabase, asUser } from "./sql/harness.mjs";
import { seedWithAccounts, ids } from "./sql/fixtures.mjs";

let db;

/** 2026-06-07 is a Sunday; the seeded Class 3 routine runs Sunday to Thursday. */
const SUNDAY = "2026-06-07";
const MONDAY = "2026-06-08";
const TUESDAY = "2026-06-09";

/** weekday -> subject id -> routine_period id, from the seeded Class 3 routine. */
let periodsByDay;

/** The seeded routine runs Sunday(0) to Thursday(4) for both subjects. */
function period(weekday, subjectId) {
  const id = periodsByDay.get(`${weekday}:${subjectId}`);
  if (!id) throw new Error(`no seeded period for weekday ${weekday}`);
  return id;
}

beforeAll(async () => {
  db = await freshDatabase();
  await seedWithAccounts(db);

  // The seed gives Class 3 section A two periods on each of Sunday–Thursday:
  // Bangla with Teacher One, Maths with Teacher Two.
  const periods = await db.query(
    `select rp.id, rp.subject_id, rp.weekday
       from public.routine_periods rp
      where rp.section_id = $1
      order by rp.weekday, rp.period_no`,
    [ids.sectionThreeA],
  );

  periodsByDay = new Map(
    periods.rows.map((r) => [`${r.weekday}:${r.subject_id}`, r.id]),
  );
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** Submits attendance as a given user and returns the RPC result. */
async function submit(userId, periodId, date, entries, reason = null) {
  return asUser(db, userId, async () => {
    const r = await db.query(
      "select public.submit_attendance($1, $2, $3::jsonb, $4) as result",
      [periodId, date, JSON.stringify(entries), reason],
    );
    return r.rows[0].result;
  });
}

async function stats(userId, studentId, from, to) {
  return asUser(db, userId, async () => {
    const r = await db.query(
      "select public.student_attendance_stats($1, $2, $3) as s",
      [studentId, from, to],
    );
    return r.rows[0].s;
  });
}

const CLASS_THREE_ROSTER = [
  ids.studentAlpha,
  ids.studentBeta,
  "57000000-0000-4000-8000-000000000005", // Epsilon
];

function allPresent() {
  return CLASS_THREE_ROSTER.map((id) => ({ student_id: id, status: "present" }));
}

// ===========================================================================
describe("who may submit attendance", () => {
  it("the scheduled teacher can", async () => {
    const result = await submit(
      ids.userTeacherOne, period(0, ids.subjectBangla), SUNDAY, allPresent(),
    );

    expect(result.marked).toBe(3);
    expect(result.correction).toBe(false);
  });

  it("a different teacher cannot", async () => {
    // Teacher Three teaches Class 8, not this Class 3 Bangla period.
    await expect(
      submit(ids.userTeacherThree, period(1, ids.subjectBangla), MONDAY, allPresent()),
    ).rejects.toThrow(/not the teacher scheduled/i);
  });

  it("a student cannot", async () => {
    await expect(
      submit(ids.userStudentAlpha, period(1, ids.subjectBangla), MONDAY, allPresent()),
    ).rejects.toThrow(/not the teacher scheduled/i);
  });

  it("the authority can, for any lesson", async () => {
    const result = await submit(
      ids.userAuthority, period(0, ids.subjectMaths), SUNDAY, allPresent(),
    );
    expect(result.marked).toBe(3);
  });

  it("a student not enrolled in the section cannot be marked", async () => {
    // The elder sibling is in Class 8.
    await expect(
      submit(ids.userTeacherOne, period(1, ids.subjectBangla), MONDAY, [
        { student_id: ids.siblingElder, status: "present" },
      ]),
    ).rejects.toThrow(/not enrolled in this section/i);
  });
});

// ===========================================================================
describe("unsubmitted is not absent", () => {
  it("a scheduled lesson with no submission has no attendance rows", async () => {
    const sessions = await db.query(
      `select count(*)::int as n from public.teaching_sessions
        where routine_period_id = $1 and session_date = $2`,
      [period(2, ids.subjectBangla), TUESDAY],
    );

    // No session row exists at all until someone submits.
    expect(sessions.rows[0].n).toBe(0);

    const marks = await db.query(
      `select count(*)::int as n
         from public.student_attendance sa
         join public.teaching_sessions ts on ts.id = sa.teaching_session_id
        where ts.session_date = $1`,
      [TUESDAY],
    );
    expect(marks.rows[0].n).toBe(0);
  });

  it("the percentage denominator counts submitted lessons only", async () => {
    // Sunday 2026-06-07 has two periods, both submitted above with Alpha
    // present. Monday and the rest of the week are scheduled but unsubmitted.
    const s = await stats(ids.userAuthority, ids.studentAlpha, "2026-06-01", "2026-06-30");

    expect(s.submitted).toBe(2);
    expect(s.present).toBe(2);
    // 2/2 = 100%, NOT 2 out of every scheduled period in June.
    expect(s.present / s.submitted).toBe(1);
  });

  it("reports unsubmitted scheduled lessons separately, never as absence", async () => {
    const s = await stats(ids.userAuthority, ids.studentAlpha, "2026-06-01", "2026-06-30");

    expect(s.absent).toBe(0);

    /*
     * This figure is derived from the ROUTINE, not from session rows
     * (migration 0028). An untouched lesson has no teaching_sessions row at
     * all, so counting rows made this structurally always zero and the
     * student-facing "lessons still outstanding" notice could never appear.
     *
     * June 2026 has many Sunday-to-Thursday occurrences of the two seeded
     * Class 3 periods; only two were submitted above, so a large number
     * remain outstanding — and none of them is an absence.
     */
    expect(s.unsubmitted_scheduled).toBeGreaterThan(0);
    expect(s.submitted).toBe(2);
    expect(s.absent).toBe(0);
  });

  it("a half-written submission does not leave a submitted session", async () => {
    // One valid student and one not enrolled: the whole statement must fail.
    await expect(
      submit(ids.userTeacherOne, period(1, ids.subjectBangla), MONDAY, [
        { student_id: ids.studentAlpha, status: "present" },
        { student_id: ids.siblingElder, status: "absent" },
      ]),
    ).rejects.toThrow();

    // Crucially: no session, so nothing reads as "everyone absent".
    const session = await db.query(
      `select count(*)::int as n from public.teaching_sessions
        where routine_period_id = $1 and session_date = $2`,
      [period(1, ids.subjectBangla), MONDAY],
    );
    expect(session.rows[0].n).toBe(0);
  });

  it("an absence is only ever an explicit mark", async () => {
    await submit(ids.userTeacherOne, period(1, ids.subjectBangla), MONDAY, [
      { student_id: ids.studentAlpha, status: "absent", remark: "unwell" },
      { student_id: ids.studentBeta, status: "present" },
      { student_id: CLASS_THREE_ROSTER[2], status: "present" },
    ]);

    const s = await stats(ids.userAuthority, ids.studentAlpha, MONDAY, MONDAY);
    expect(s.absent).toBe(1);
    expect(s.present).toBe(0);
    expect(s.submitted).toBe(1);

    // And the other two students are unaffected.
    const beta = await stats(ids.userAuthority, ids.studentBeta, MONDAY, MONDAY);
    expect(beta.present).toBe(1);
    expect(beta.absent).toBe(0);
  });
});

// ===========================================================================
describe("attendance calculations", () => {
  it("counts a late mark as present", async () => {
    // Maths belongs to Teacher Two in the seeded routine.
    await submit(ids.userTeacherTwo, period(1, ids.subjectMaths), MONDAY, [
      { student_id: ids.studentAlpha, status: "late" },
      { student_id: ids.studentBeta, status: "present" },
      { student_id: CLASS_THREE_ROSTER[2], status: "present" },
    ]);

    const s = await stats(ids.userAuthority, ids.studentAlpha, MONDAY, MONDAY);
    // Bangla absent + Maths late => present 1 (the late), absent 1, submitted 2.
    expect(s.late).toBe(1);
    expect(s.present).toBe(1);
    expect(s.submitted).toBe(2);
  });

  it("excludes dates outside the window", async () => {
    const s = await stats(ids.userAuthority, ids.studentAlpha, TUESDAY, TUESDAY);
    expect(s.submitted).toBe(0);
    expect(s.present).toBe(0);
  });

  it("breaks down by subject using the same denominator rule", async () => {
    const rows = await asUser(db, ids.userAuthority, async () =>
      (await db.query(
        "select * from public.student_attendance_by_subject($1, $2, $3)",
        [ids.studentAlpha, "2026-06-01", "2026-06-30"],
      )).rows,
    );

    const bangla = rows.find((r) => r.subject_name === "Bangla");
    const maths = rows.find((r) => r.subject_name === "Mathematics");

    // Bangla: Sunday present + Monday absent = 1 present of 2 submitted.
    expect(Number(bangla.submitted)).toBe(2);
    expect(Number(bangla.present)).toBe(1);
    expect(Number(bangla.absent)).toBe(1);

    // Maths: Sunday present + Monday late = 2 present of 2 submitted.
    expect(Number(maths.submitted)).toBe(2);
    expect(Number(maths.present)).toBe(2);
  });

  it("section totals sum marks rather than averaging averages", async () => {
    const rows = await asUser(db, ids.userAuthority, async () =>
      (await db.query(
        "select * from public.section_attendance_stats($1, $2, $3)",
        [ids.academicYear, "2026-06-01", "2026-06-30"],
      )).rows,
    );

    const three = rows.find((r) => r.section_id === ids.sectionThreeA);

    // Four submitted lessons x three students = 12 marks.
    // Present-or-late: Sunday Bangla 3 + Sunday Maths 3 + Monday Bangla 2
    // (Alpha absent) + Monday Maths 3 (Alpha late counts present) = 11.
    expect(Number(three.submitted_marks)).toBe(12);
    expect(Number(three.present_marks)).toBe(11);
    expect(Number(three.students)).toBe(3);
  });

  it("a section with no submitted attendance reports zero, not a percentage", async () => {
    const rows = await asUser(db, ids.userAuthority, async () =>
      (await db.query(
        "select * from public.section_attendance_stats($1, $2, $3)",
        [ids.academicYear, "2026-06-01", "2026-06-30"],
      )).rows,
    );

    const eight = rows.find((r) => r.section_id === ids.sectionEightA);

    // The caller must render "no data" rather than 0%, which the UI does by
    // treating a zero denominator as null.
    expect(Number(eight.submitted_marks)).toBe(0);
    expect(Number(eight.present_marks)).toBe(0);
  });
});

// ===========================================================================
describe("who may read attendance", () => {
  it("a student can read their own stats", async () => {
    const s = await stats(ids.userStudentAlpha, ids.studentAlpha, MONDAY, MONDAY);
    expect(s.submitted).toBe(2);
  });

  it("a student cannot read another student's stats", async () => {
    await expect(
      stats(ids.userStudentAlpha, ids.siblingElder, MONDAY, MONDAY),
    ).rejects.toThrow(/not permitted/i);
  });

  it("a teacher can read a student they teach", async () => {
    const s = await stats(ids.userTeacherOne, ids.studentAlpha, MONDAY, MONDAY);
    expect(s.submitted).toBe(2);
  });

  it("a teacher cannot read a student they do not teach", async () => {
    await expect(
      stats(ids.userTeacherOne, ids.siblingElder, MONDAY, MONDAY),
    ).rejects.toThrow(/not permitted/i);
  });

  it("section stats are authority-only", async () => {
    const rows = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query(
        "select * from public.section_attendance_stats($1, $2, $3)",
        [ids.academicYear, "2026-06-01", "2026-06-30"],
      )).rows,
    );

    // The function filters on app.is_authority(), so a teacher gets nothing.
    expect(rows).toHaveLength(0);
  });
});

// ===========================================================================
describe("corrections", () => {
  it("a correction without a reason is refused", async () => {
    await expect(
      submit(ids.userTeacherOne, period(1, ids.subjectBangla), MONDAY, [
        { student_id: ids.studentAlpha, status: "present" },
        { student_id: ids.studentBeta, status: "present" },
        { student_id: CLASS_THREE_ROSTER[2], status: "present" },
      ]),
    ).rejects.toThrow(/requires a reason/i);
  });

  it("a correction with a reason is applied and audited", async () => {
    const result = await submit(
      ids.userTeacherOne, period(1, ids.subjectBangla), MONDAY,
      [
        { student_id: ids.studentAlpha, status: "present" },
        { student_id: ids.studentBeta, status: "present" },
        { student_id: CLASS_THREE_ROSTER[2], status: "present" },
      ],
      "Marked absent in error; guardian confirmed attendance.",
    );

    expect(result.correction).toBe(true);

    const s = await stats(ids.userAuthority, ids.studentAlpha, MONDAY, MONDAY);
    expect(s.absent).toBe(0);
    expect(s.present).toBe(2);

    // The change itself is in the audit log via the generic trigger.
    const audit = await db.query(
      `select count(*)::int as n from public.audit_logs
        where table_name = 'student_attendance' and action = 'update'`,
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it("submitted_at is not moved by a correction", async () => {
    const before = await db.query(
      `select submitted_at from public.teaching_sessions
        where routine_period_id = $1 and session_date = $2`,
      [period(1, ids.subjectBangla), MONDAY],
    );

    await submit(
      ids.userTeacherOne, period(1, ids.subjectBangla), MONDAY,
      CLASS_THREE_ROSTER.map((id) => ({ student_id: id, status: "present" })),
      "Second correction.",
    );

    const after = await db.query(
      `select submitted_at from public.teaching_sessions
        where routine_period_id = $1 and session_date = $2`,
      [period(1, ids.subjectBangla), MONDAY],
    );

    // coalesce keeps the ORIGINAL submission time, so "when was this lesson
    // first submitted" survives later corrections.
    expect(after.rows[0].submitted_at).toEqual(before.rows[0].submitted_at);
  });
});

// ===========================================================================
describe("dates that have no lesson", () => {
  it("refuses a date that is not the period's weekday", async () => {
    // 2026-06-13 is a Saturday; this period runs on Sunday.
    await expect(
      submit(ids.userTeacherOne, period(0, ids.subjectBangla), "2026-06-13", allPresent()),
    ).rejects.toThrow(/not a .* for this period/i);
  });

  it("refuses a school holiday", async () => {
    await db.query(
      `insert into public.school_holidays (academic_year_id, holiday_date, name)
       values ($1, '2026-06-14', 'Test Holiday')`,
      [ids.academicYear],
    );

    await expect(
      submit(ids.userTeacherOne, period(0, ids.subjectBangla), "2026-06-14", allPresent()),
    ).rejects.toThrow(/school holiday/i);
  });

  it("refuses a cancelled period", async () => {
    await db.query(
      `insert into public.cancelled_periods (routine_period_id, occurs_on, reason)
       values ($1, '2026-06-21', 'Teacher training')`,
      [period(0, ids.subjectBangla)],
    );

    await expect(
      submit(ids.userTeacherOne, period(0, ids.subjectBangla), "2026-06-21", allPresent()),
    ).rejects.toThrow(/cancelled/i);
  });

  it("refuses a date before the period took effect", async () => {
    await expect(
      submit(ids.userTeacherOne, period(0, ids.subjectBangla), "2025-06-08", allPresent()),
    ).rejects.toThrow(/effective dates|not a .* for this period/i);
  });
});

// ===========================================================================
describe("pending attendance", () => {
  it("lists scheduled lessons with no submission, skipping holidays", async () => {
    const rows = await asUser(db, ids.userAuthority, async () =>
      (await db.query(
        "select * from public.pending_attendance($1, $2, null)",
        ["2026-06-07", "2026-06-21"],
      )).rows,
    );

    const dates = rows.map((r) => r.session_date.toISOString?.().slice(0, 10) ?? String(r.session_date));

    // The holiday and the cancelled period must not appear as outstanding.
    expect(dates).not.toContain("2026-06-14");
    // Sunday 07 and Monday 08 were submitted, so they are not pending either.
    expect(dates).not.toContain("2026-06-07");
    // But later untouched days are.
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a teacher sees only their own pending lessons", async () => {
    const rows = await asUser(db, ids.userTeacherThree, async () =>
      (await db.query(
        "select * from public.pending_attendance($1, $2, null)",
        ["2026-06-07", "2026-06-21"],
      )).rows,
    );

    // Teacher Three teaches only Class 8 English.
    for (const r of rows) {
      expect(r.teacher_id).toBe(ids.teacherThree);
    }
  });
});

// ===========================================================================
describe("routine clash prevention", () => {
  async function addPeriod(overrides = {}) {
    const body = {
      academic_year_id: ids.academicYear,
      class_id: ids.classThree,
      section_id: ids.sectionThreeA,
      subject_id: ids.subjectEnglish,
      teacher_id: ids.teacherThree,
      weekday: 1,
      period_no: 9,
      starts_at: "11:00",
      ends_at: "11:45",
      effective_from: "2026-01-01",
      ...overrides,
    };

    return asUser(db, ids.userAuthority, async () =>
      db.query(
        `insert into public.routine_periods
           (academic_year_id, class_id, section_id, subject_id, teacher_id,
            weekday, period_no, starts_at, ends_at, effective_from)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [
          body.academic_year_id, body.class_id, body.section_id, body.subject_id,
          body.teacher_id, body.weekday, body.period_no, body.starts_at,
          body.ends_at, body.effective_from,
        ],
      ),
    );
  }

  it("allows a non-overlapping period", async () => {
    const r = await addPeriod();
    expect(r.rows[0].id).toBeTruthy();
  });

  it("refuses a second lesson for the same class at the same time", async () => {
    await expect(
      addPeriod({ period_no: 10, subject_id: ids.subjectMaths, teacher_id: ids.teacherTwo ?? ids.teacherThree }),
    ).rejects.toThrow(/no_section_clash|exclusion|conflicting/i);
  });

  it("refuses the same teacher in two classes at the same time", async () => {
    await expect(
      addPeriod({
        section_id: ids.sectionEightA,
        class_id: ids.classEight,
        period_no: 11,
        teacher_id: ids.teacherThree,
      }),
    ).rejects.toThrow(/no_teacher_clash|exclusion|conflicting/i);
  });

  it("allows the same teacher at a non-overlapping time", async () => {
    const r = await addPeriod({
      section_id: ids.sectionEightA,
      class_id: ids.classEight,
      period_no: 12,
      starts_at: "12:00",
      ends_at: "12:45",
      teacher_id: ids.teacherThree,
    });
    expect(r.rows[0].id).toBeTruthy();
  });

  it("only the authority may edit the routine", async () => {
    await expect(
      asUser(db, ids.userTeacherOne, async () =>
        db.query(
          `insert into public.routine_periods
             (academic_year_id, class_id, section_id, subject_id, teacher_id,
              weekday, period_no, starts_at, ends_at, effective_from)
           values ($1,$2,$3,$4,$5,4,15,'14:00','14:45','2026-01-01')`,
          [ids.academicYear, ids.classThree, ids.sectionThreeA,
           ids.subjectEnglish, ids.teacherOne],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
