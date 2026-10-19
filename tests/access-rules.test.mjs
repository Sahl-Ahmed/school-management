/**
 * Cross-role access tests.
 *
 * These exercise the RLS policies directly, as the `authenticated` role with a
 * JWT subject, which is exactly how PostgREST runs a request. A passing test
 * here means the database refuses the access, not merely that the UI hides it.
 *
 * Covers the access items from brief section 10.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDatabase, asUser, asAnon } from "./sql/harness.mjs";
import { seedWithAccounts, ids } from "./sql/fixtures.mjs";

let db;

beforeAll(async () => {
  db = await freshDatabase();
  await seedWithAccounts(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
describe("student isolation", () => {
  it("a student reads exactly one student row — their own", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () => {
      const r = await db.query("select id, registration_no from public.students");
      return r.rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(ids.studentAlpha);
  });

  it("naming another student's id in a WHERE clause returns nothing", async () => {
    // The attack the brief describes: typing someone else's identifier into a
    // URL. A filter cannot widen what RLS allows.
    const rows = await asUser(db, ids.userStudentAlpha, async () => {
      const r = await db.query(
        "select id from public.students where registration_no = $1",
        ["STU-2026-0003"],
      );
      return r.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it("a student cannot read another student's fee charges", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () => {
      const r = await db.query(
        "select id from public.fee_charges where student_id = $1",
        [ids.siblingElder],
      );
      return r.rows;
    });

    expect(rows).toHaveLength(0);
  });

  it("a student cannot read anyone's private identifiers, including their own", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () => {
      const r = await db.query("select student_id from public.student_private_ids");
      return r.rows;
    });

    // No student policy exists on this table at all.
    expect(rows).toHaveLength(0);
  });

  it("a student cannot change their own registration number", async () => {
    await asUser(db, ids.userStudentAlpha, async () => {
      const r = await db.query(
        "update public.students set registration_no = 'HACKED' where id = $1 returning id",
        [ids.studentAlpha],
      );
      // The student has SELECT but no UPDATE policy, so the row is invisible
      // to the UPDATE and nothing is modified.
      expect(r.rows).toHaveLength(0);
    });

    const check = await db.query(
      "select registration_no from public.students where id = $1",
      [ids.studentAlpha],
    );
    expect(check.rows[0].registration_no).toBe("STU-2026-0001");
  });
});

// ---------------------------------------------------------------------------
describe("siblings sharing one guardian phone", () => {
  it("two students share an SMS target number", async () => {
    const r = await db.query(`
      select phone, count(*)::int as n
      from public.student_contacts
      where is_sms_target
      group by phone having count(*) > 1
    `);

    expect(r.rows).toEqual([{ phone: "+8801300000303", n: 2 }]);
  });

  it("each sibling still has a distinct registration number and account", async () => {
    const r = await db.query(
      `select registration_no, auth_user_id from public.students
        where id in ($1, $2) order by registration_no`,
      [ids.siblingElder, ids.siblingYounger],
    );

    expect(r.rows.map((x) => x.registration_no)).toEqual([
      "STU-2026-0003",
      "STU-2026-0004",
    ]);
    expect(r.rows[0].auth_user_id).not.toBe(r.rows[1].auth_user_id);
  });

  it("each sibling sees only their own record despite the shared phone", async () => {
    const elder = await asUser(db, ids.userSiblingElder, async () =>
      (await db.query("select id from public.students")).rows,
    );
    const younger = await asUser(db, ids.userSiblingYounger, async () =>
      (await db.query("select id from public.students")).rows,
    );

    expect(elder).toEqual([{ id: ids.siblingElder }]);
    expect(younger).toEqual([{ id: ids.siblingYounger }]);
  });
});

// ---------------------------------------------------------------------------
describe("teacher scope follows assignments", () => {
  it("a teacher sees only students in sections they are assigned to", async () => {
    // Teacher One teaches Bangla to Class 3 only.
    const rows = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query("select id from public.students order by id")).rows,
    );

    const visible = rows.map((r) => r.id);
    expect(visible).toContain(ids.studentAlpha);     // Class 3
    expect(visible).toContain(ids.studentBeta);      // Class 3
    expect(visible).not.toContain(ids.siblingElder);   // Class 8
    expect(visible).not.toContain(ids.siblingYounger); // Class 1
  });

  it("a teacher in another class cannot see Class 3 students", async () => {
    const rows = await asUser(db, ids.userTeacherThree, async () =>
      (await db.query("select id from public.students order by id")).rows,
    );

    const visible = rows.map((r) => r.id);
    expect(visible).toContain(ids.siblingElder);  // Class 8 — theirs
    expect(visible).not.toContain(ids.studentAlpha);
  });

  it("a teacher cannot read any student's fees", async () => {
    const rows = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query("select id from public.fee_charges")).rows,
    );

    expect(rows).toHaveLength(0);
  });

  it("a teacher cannot read guardian phone numbers", async () => {
    const rows = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query("select phone from public.student_contacts")).rows,
    );

    expect(rows).toHaveLength(0);
  });

  it("a teacher cannot read parent NIDs", async () => {
    const rows = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query("select father_nid from public.student_private_ids")).rows,
    );

    expect(rows).toHaveLength(0);
  });

  it("a teacher cannot open a teaching session for a section they do not teach", async () => {
    await asUser(db, ids.userTeacherOne, async () => {
      // Teacher One is Bangla/Class 3; this targets Class 8 section A.
      const period = await db.query(
        `select id from public.routine_periods where section_id = $1 limit 1`,
        [ids.sectionThreeA],
      );

      await expect(
        db.query(
          `insert into public.teaching_sessions
             (routine_period_id, session_date, class_id, section_id, subject_id,
              teacher_id, period_no, starts_at, ends_at)
           values ($1, '2026-06-01', $2, $3, $4, $5, 1, '08:00', '08:45')`,
          [
            period.rows[0].id,
            ids.classEight,
            ids.sectionEightA,
            ids.subjectEnglish,
            ids.teacherOne,
          ],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("a teacher cannot create a session attributed to another teacher", async () => {
    await asUser(db, ids.userTeacherOne, async () => {
      const period = await db.query(
        `select id from public.routine_periods where section_id = $1 limit 1`,
        [ids.sectionThreeA],
      );

      await expect(
        db.query(
          `insert into public.teaching_sessions
             (routine_period_id, session_date, class_id, section_id, subject_id,
              teacher_id, period_no, starts_at, ends_at)
           values ($1, '2026-06-02', $2, $3, $4, $5, 1, '08:00', '08:45')`,
          [
            period.rows[0].id,
            ids.classThree,
            ids.sectionThreeA,
            ids.subjectBangla,
            ids.teacherThree, // not the caller
          ],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });
});

// ---------------------------------------------------------------------------
describe("unsubmitted attendance is not absence", () => {
  it("a scheduled lesson with no submission has no attendance rows", async () => {
    const period = await db.query(
      `select id from public.routine_periods where section_id = $1 and weekday = 0 limit 1`,
      [ids.sectionThreeA],
    );

    const session = await db.query(
      `insert into public.teaching_sessions
         (routine_period_id, session_date, class_id, section_id, subject_id,
          teacher_id, period_no, starts_at, ends_at)
       values ($1, '2026-06-07', $2, $3, $4, $5, 1, '08:00', '08:45')
       returning id, submitted_at`,
      [
        period.rows[0].id,
        ids.classThree,
        ids.sectionThreeA,
        ids.subjectBangla,
        ids.teacherOne,
      ],
    );

    expect(session.rows[0].submitted_at).toBeNull();

    const attendance = await db.query(
      "select count(*)::int as n from public.student_attendance where teaching_session_id = $1",
      [session.rows[0].id],
    );
    expect(attendance.rows[0].n).toBe(0);
  });

  it("a student's attendance percentage counts only submitted lessons", async () => {
    // One submitted lesson where the student was present, plus the unsubmitted
    // lesson created above. Only the submitted one may count.
    const period = await db.query(
      `select id from public.routine_periods where section_id = $1 and weekday = 1 limit 1`,
      [ids.sectionThreeA],
    );

    const session = await db.query(
      `insert into public.teaching_sessions
         (routine_period_id, session_date, class_id, section_id, subject_id,
          teacher_id, period_no, starts_at, ends_at, submitted_at)
       values ($1, '2026-06-08', $2, $3, $4, $5, 1, '08:00', '08:45', now())
       returning id`,
      [
        period.rows[0].id,
        ids.classThree,
        ids.sectionThreeA,
        ids.subjectBangla,
        ids.teacherOne,
      ],
    );

    await db.query(
      `insert into public.student_attendance (teaching_session_id, student_id, status)
       values ($1, $2, 'present')`,
      [session.rows[0].id, ids.studentAlpha],
    );

    const stats = await db.query(
      `select
         count(*) filter (where ts.submitted_at is not null)::int as submitted_lessons,
         count(sa.id) filter (where sa.status = 'present')::int as present
       from public.teaching_sessions ts
       left join public.student_attendance sa
         on sa.teaching_session_id = ts.id and sa.student_id = $1
       where ts.section_id = $2 and ts.session_date in ('2026-06-07', '2026-06-08')`,
      [ids.studentAlpha, ids.sectionThreeA],
    );

    // Two lessons exist; only one was submitted, and the percentage is 1/1,
    // not 1/2. The unsubmitted lesson is excluded, not counted as an absence.
    expect(stats.rows[0].submitted_lessons).toBe(1);
    expect(stats.rows[0].present).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("public QR card", () => {
  let token;

  beforeAll(async () => {
    token = "qr_" + "a".repeat(40);
    await db.query(
      `insert into public.qr_tokens (token, student_id, card_snapshot)
       values ($1, $2, $3::jsonb)`,
      [
        token,
        ids.studentAlpha,
        JSON.stringify({
          full_name: "Demo Student Alpha",
          registration_no: "STU-2026-0001",
          roll_no: 1,
          class_name: "Class 3",
          section_name: "A",
          blood_group: "B+",
          photo_url: "student-photos/demo.jpg",
        }),
      ],
    );
  });

  it("an anonymous visitor gets the card fields and school branding", async () => {
    const result = await asAnon(db, async () =>
      (await db.query("select public.get_public_card($1) as card", [token])).rows[0].card,
    );

    expect(result.card.registration_no).toBe("STU-2026-0001");
    expect(result.school.name).toBe("School");
    expect(result.school.office_phone).toBe("+8801300000000");
  });

  it("the public card exposes no parent names, NIDs, fees, marks or attendance", async () => {
    const result = await asAnon(db, async () =>
      (await db.query("select public.get_public_card($1) as card", [token])).rows[0].card,
    );

    const serialised = JSON.stringify(result);
    for (const forbidden of [
      "father", "mother", "nid", "birth_certificate",
      "fee", "mark", "gpa", "attendance", "password",
    ]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("an anonymous visitor cannot read any table directly", async () => {
    await asAnon(db, async () => {
      await expect(db.query("select * from public.students")).rejects.toThrow(/permission denied/i);
      await expect(db.query("select * from public.qr_tokens")).rejects.toThrow(/permission denied/i);
      await expect(db.query("select * from public.student_contacts")).rejects.toThrow(/permission denied/i);
    });
  });

  it("a revoked token stops resolving", async () => {
    await db.query(
      `update public.qr_tokens set revoked_at = now(), revoke_reason = 'card lost'
        where token = $1`,
      [token],
    );

    const result = await asAnon(db, async () =>
      (await db.query("select public.get_public_card($1) as card", [token])).rows[0].card,
    );

    expect(result).toBeNull();
  });

  it("the database refuses a snapshot containing forbidden fields", async () => {
    await expect(
      db.query(
        `insert into public.qr_tokens (token, student_id, card_snapshot)
         values ($1, $2, $3::jsonb)`,
        [
          "qr_" + "b".repeat(40),
          ids.studentBeta,
          JSON.stringify({ full_name: "X", father_name: "Should Not Be Here" }),
        ],
      ),
    ).rejects.toThrow(/father_name/);
  });
});

// ---------------------------------------------------------------------------
describe("feedback anonymity", () => {
  it("feedback_responses has no column referencing a student", async () => {
    const cols = await db.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'feedback_responses'
    `);

    const names = cols.rows.map((r) => r.column_name);
    expect(names).not.toContain("student_id");
    expect(names.some((n) => n.includes("student"))).toBe(false);
  });

  it("feedback_comments has no column referencing a student", async () => {
    const cols = await db.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'feedback_comments'
    `);

    expect(cols.rows.map((r) => r.column_name).some((n) => n.includes("student"))).toBe(false);
  });

  it("no foreign key points from a feedback answer to a student", async () => {
    const fks = await db.query(`
      select tc.table_name, ccu.table_name as references_table
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
        and tc.table_name in ('feedback_responses', 'feedback_comments')
    `);

    expect(fks.rows.map((r) => r.references_table)).not.toContain("students");
  });

  it("a teacher cannot read feedback responses or comments at all", async () => {
    const [responses, comments] = await asUser(db, ids.userTeacherOne, async () => [
      (await db.query("select * from public.feedback_responses")).rows,
      (await db.query("select * from public.feedback_comments")).rows,
    ]);

    expect(responses).toHaveLength(0);
    expect(comments).toHaveLength(0);
  });

  it("a teacher cannot read who completed feedback", async () => {
    const rows = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query("select * from public.feedback_completions")).rows,
    );

    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("idempotency guards", () => {
  it("only one daily attendance SMS job can exist per student per day", async () => {
    const key = `daily_attendance|${ids.studentAlpha}|2026-06-08`;

    await db.query(
      `insert into public.notification_jobs
         (type, student_id, target_phone, job_date, dedupe_key, body, segments)
       values ('daily_attendance', $1, '+8801300000301', '2026-06-08', $2, 'test', 1)`,
      [ids.studentAlpha, key],
    );

    // A re-run of the scheduler must not create a second job.
    await expect(
      db.query(
        `insert into public.notification_jobs
           (type, student_id, target_phone, job_date, dedupe_key, body, segments)
         values ('daily_attendance', $1, '+8801300000301', '2026-06-08', $2, 'test again', 1)`,
        [ids.studentAlpha, key],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);

    const count = await db.query(
      `select count(*)::int as n from public.notification_jobs
        where student_id = $1 and job_date = '2026-06-08'
          and type = 'daily_attendance'`,
      [ids.studentAlpha],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("a replayed K40 punch does not create a second event", async () => {
    const device = await db.query(
      `insert into public.devices (name, serial_no) values ('Demo K40', 'SYNTH-0001')
       returning id`,
    );
    const deviceId = device.rows[0].id;

    const dedupe = `${deviceId}|101|2026-06-08T02:05:00Z|0`;

    await db.query(
      `insert into public.raw_punch_events
         (device_id, device_user_id, punched_at, punch_state, dedupe_key)
       values ($1, '101', '2026-06-08T02:05:00Z', 0, $2)`,
      [deviceId, dedupe],
    );

    // The bridge re-uploads its backlog after the PC comes back online.
    await expect(
      db.query(
        `insert into public.raw_punch_events
           (device_id, device_user_id, punched_at, punch_state, dedupe_key)
         values ($1, '101', '2026-06-08T02:05:00Z', 0, $2)`,
        [deviceId, dedupe],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);

    const count = await db.query(
      `select count(*)::int as n from public.raw_punch_events where dedupe_key = $1`,
      [dedupe],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("a student cannot be billed twice for the same month", async () => {
    await expect(
      db.query(
        `insert into public.fee_charges
           (student_id, fee_type_id, academic_year_id, period_year, period_month, amount)
         values ($1, 'fee00000-0000-4000-8000-000000000001', $2, 2026, 1, 550)`,
        [ids.studentAlpha, ids.academicYear],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("a payment cannot be allocated beyond its own amount", async () => {
    const charge = await db.query(
      `select id, amount from public.fee_charges
        where student_id = $1 and period_month = 2 limit 1`,
      [ids.studentAlpha],
    );

    const payment = await db.query(
      `insert into public.payments (student_id, amount, method) values ($1, 100, 'cash')
       returning id`,
      [ids.studentAlpha],
    );

    await expect(
      db.query(
        `insert into public.payment_allocations (payment_id, fee_charge_id, amount)
         values ($1, $2, 500)`,
        [payment.rows[0].id, charge.rows[0].id],
      ),
    ).rejects.toThrow(/exceed/i);
  });
});

// ---------------------------------------------------------------------------
describe("admit card eligibility", () => {
  let examId;

  beforeAll(async () => {
    const exam = await db.query(
      `insert into public.exams (academic_year_id, term_id, name, status)
       values ($1, $2, 'Second Term Exam', 'scheduled')
       returning id`,
      [ids.academicYear, ids.termSecond],
    );
    examId = exam.rows[0].id;
  });

  it("blocks the card when no rule is configured, rather than issuing it", async () => {
    const r = await db.query(
      "select public.admit_card_eligibility($1, $2) as e",
      [ids.studentAlpha, examId],
    );

    expect(r.rows[0].e.eligible).toBe(false);
    expect(r.rows[0].e.blocks).toContain("no_rule_configured");
  });

  it("blocks the card when required feedback is incomplete", async () => {
    const campaign = await db.query(
      `insert into public.feedback_campaigns
         (academic_year_id, term_id, name, status, blocks_admit_card)
       values ($1, $2, 'Second Term Feedback', 'open', true)
       returning id`,
      [ids.academicYear, ids.termSecond],
    );

    await db.query(
      `insert into public.admit_card_rules
         (exam_id, require_feedback, feedback_campaign_id,
          require_fees_cleared, require_exam_fee_paid)
       values ($1, true, $2, false, false)`,
      [examId, campaign.rows[0].id],
    );

    const r = await db.query(
      "select public.admit_card_eligibility($1, $2) as e",
      [ids.studentAlpha, examId],
    );

    expect(r.rows[0].e.eligible).toBe(false);
    expect(r.rows[0].e.blocks).toContain("feedback_incomplete");
  });

  it("blocks the card when monthly fees are outstanding", async () => {
    await db.query(
      `update public.admit_card_rules
          set require_feedback = false,
              require_fees_cleared = true,
              fees_cleared_through_year = 2026,
              fees_cleared_through_month = 6
        where exam_id = $1`,
      [examId],
    );

    const r = await db.query(
      "select public.admit_card_eligibility($1, $2) as e",
      [ids.studentAlpha, examId],
    );

    // The seed bills six months and records no payments.
    expect(r.rows[0].e.eligible).toBe(false);
    expect(r.rows[0].e.blocks).toContain("monthly_fees_outstanding");
    expect(Number(r.rows[0].e.outstanding_monthly)).toBeGreaterThan(0);
  });

  it("the office sees the same verdict the student does", async () => {
    const [staffView, studentView] = await Promise.all([
      asUser(db, ids.userOfficeStaff, async () =>
        (await db.query("select public.admit_card_eligibility($1, $2) as e",
          [ids.studentAlpha, examId])).rows[0].e,
      ),
      asUser(db, ids.userStudentAlpha, async () =>
        (await db.query("select public.admit_card_eligibility($1, $2) as e",
          [ids.studentAlpha, examId])).rows[0].e,
      ),
    ]);

    expect(staffView.eligible).toBe(studentView.eligible);
    expect(staffView.blocks).toEqual(studentView.blocks);
  });
});

// ---------------------------------------------------------------------------
describe("draft marks stay private until publication", () => {
  it("a student cannot read an unpublished exam", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query("select id from public.exams")).rows,
    );

    // Nothing in the seed has routine_published_at set.
    expect(rows).toHaveLength(0);
  });

  it("a student cannot read the marks table", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query("select id from public.marks")).rows,
    );

    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("audit trail", () => {
  it("an authority change to a student is recorded with the actor", async () => {
    await asUser(db, ids.userAuthority, async () => {
      await db.query(
        "update public.students set blood_group = 'O-' where id = $1",
        [ids.studentBeta],
      );
    });

    const log = await db.query(
      `select actor_id, actor_role, action, changed_fields
         from public.audit_logs
        where table_name = 'students' and record_id = $1
        order by occurred_at desc limit 1`,
      [ids.studentBeta],
    );

    expect(log.rows[0].actor_id).toBe(ids.userAuthority);
    expect(log.rows[0].actor_role).toBe("authority_admin");
    expect(log.rows[0].action).toBe("update");
    expect(log.rows[0].changed_fields).toContain("blood_group");
  });

  it("a student cannot read the audit log", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query("select id from public.audit_logs")).rows,
    );

    expect(rows).toHaveLength(0);
  });
});
