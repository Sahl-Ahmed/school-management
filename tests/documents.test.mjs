/**
 * Phase 6: feedback anonymity, admit-card eligibility, QR cards, printables.
 *
 * The dangerous failures this guards against, in order of how bad they are:
 *
 *   1. A teacher learning who said what. The model makes this structurally
 *      impossible — there is no column linking a rating to a student — and
 *      these tests assert that, including through every aggregate the office
 *      has, because a view added carelessly later is the realistic way it
 *      would break.
 *   2. The public QR page leaking something the card does not print. Parent
 *      names, NIDs, fees, marks and attendance are refused by a trigger rather
 *      than merely omitted from a template.
 *   3. An admit card issued to a student the rules block — especially by the
 *      office, from a different screen, which is the case the brief calls out.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDatabase, asUser, asAnon, expectRejected } from "./sql/harness.mjs";
import { seedWithAccounts, ids } from "./sql/fixtures.mjs";

let db;

const EPSILON = "57000000-0000-4000-8000-000000000005";
const ID_TEMPLATE_PORTRAIT = "d0c00000-0000-4000-8000-000000000001";
const ID_TEMPLATE_LANDSCAPE = "d0c00000-0000-4000-8000-000000000002";

let campaignId;
let questionIds = [];
let examId;

beforeAll(async () => {
  db = await freshDatabase();
  await seedWithAccounts(db);

  // A second-term exam for Class 3, so admit cards have something to belong to.
  const exam = await db.query(
    `insert into public.exams
       (academic_year_id, term_id, name, status, starts_on, ends_on)
     values ($1, $2, 'Second Term Exam', 'scheduled', '2026-06-01', '2026-06-10')
     returning id`,
    [ids.academicYear, ids.termSecond],
  );
  examId = exam.rows[0].id;

  await db.query(
    `insert into public.exam_subjects (exam_id, class_id, subject_id, max_marks, pass_marks)
     values ($1, $2, $3, 100, 33), ($1, $2, $4, 100, 33)`,
    [examId, ids.classThree, ids.subjectBangla, ids.subjectMaths],
  );

  // A feedback round for the same term.
  const campaign = await db.query(
    `insert into public.feedback_campaigns
       (academic_year_id, term_id, name, status, blocks_admit_card, min_periods_taught)
     values ($1, $2, 'Second Term feedback', 'draft', true, 1)
     returning id`,
    [ids.academicYear, ids.termSecond],
  );
  campaignId = campaign.rows[0].id;

  const questions = await db.query(
    `insert into public.feedback_questions (campaign_id, prompt, prompt_bn, order_no, scale_min, scale_max)
     values
       ($1, 'Does this teacher explain clearly?', 'এই শিক্ষক কি স্পষ্টভাবে বোঝান?', 1, 1, 5),
       ($1, 'Can you ask questions comfortably?', 'আপনি কি সহজে প্রশ্ন করতে পারেন?', 2, 1, 5)
     returning id`,
    [campaignId],
  );
  questionIds = questions.rows.map((r) => r.id);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const rpc = (userId, sql, params) =>
  asUser(db, userId, async () => (await db.query(sql, params)).rows[0]);

const rows = (userId, sql, params) =>
  asUser(db, userId, async () => (await db.query(sql, params)).rows);

/**
 * Records submitted lessons so a teacher clears min_periods_taught.
 *
 * Written straight to teaching_sessions, which is what the target generator
 * counts — and deliberately not through the routine, because the point is to
 * assert the generator reads the session's own snapshot of who taught.
 */
let slotCursor = 0;

async function recordLessons(teacherId, subjectId, sectionId, classId, count, from = "2026-05-04") {
  const start = new Date(`${from}T00:00:00Z`);

  for (let i = 0; i < count; i++) {
    const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);

    /*
     * Each call takes its own band of period numbers and clock times.
     *
     * The routine carries exclusion constraints over (section, weekday, time)
     * and (teacher, weekday, time), so two teachers given the same slots in
     * one section silently produce no rows at all — the insert is rejected,
     * `on conflict do nothing` swallows it, and the periods_taught count stays
     * zero. A shared cursor keeps every fixture lesson in a free slot.
     */
    const n = slotCursor + i;
    const slot = 20 + n;
    // Weekday cycles, the hour advances every five lessons, and both start
    // after the seeded school day — so a fixture lesson can never land on a
    // seeded routine period or on another fixture lesson.
    const weekday = n % 5;
    const hour = 17 + Math.floor(n / 5);
    const starts = `${String(hour).padStart(2, "0")}:00`;
    const ends = `${String(hour).padStart(2, "0")}:40`;

    const period = await db.query(
      `insert into public.routine_periods
         (academic_year_id, class_id, section_id, subject_id, teacher_id,
          weekday, period_no, starts_at, ends_at, effective_from)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '2026-01-01')
       returning id`,
      [
        ids.academicYear, classId, sectionId, subjectId, teacherId,
        weekday, slot, starts, ends,
      ],
    );
    const periodId = period.rows[0].id;

    await db.query(
      `insert into public.teaching_sessions
         (routine_period_id, session_date, class_id, section_id, subject_id,
          teacher_id, period_no, starts_at, ends_at, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
      [periodId, date, classId, sectionId, subjectId, teacherId, slot, starts, ends],
    );
  }

  slotCursor += count;
}

// ===========================================================================
describe("feedback targeting follows the owner's mid-term rule", () => {
  it("refuses to generate forms before the questions exist", async () => {
    const bare = await db.query(
      `insert into public.feedback_campaigns
         (academic_year_id, term_id, name, status)
       values ($1, $2, 'Questionless round', 'draft')
       returning id`,
      [ids.academicYear, ids.termSecond],
    );

    await expectRejected(() =>
      rpc(ids.userAuthority, "select public.generate_feedback_targets($1) as r", [
        bare.rows[0].id,
      ]),
    );

    await db.query("delete from public.feedback_campaigns where id = $1", [
      bare.rows[0].id,
    ]);
  });

  it("leaves out a teacher below the minimum lessons taught", async () => {
    // No lessons recorded yet, so nothing clears min_periods_taught = 1.
    const r = await rpc(
      ids.userAuthority,
      "select public.generate_feedback_targets($1) as r",
      [campaignId],
    );

    expect(r.r.forms).toBe(0);
    expect(r.r.skipped_too_few_periods).toBeGreaterThan(0);
  });

  it("generates one form per teacher once each has taught enough", async () => {
    await recordLessons(ids.teacherOne, ids.subjectBangla, ids.sectionThreeA, ids.classThree, 6);
    await recordLessons(ids.teacherTwo, ids.subjectMaths, ids.sectionThreeA, ids.classThree, 4, "2026-05-18");

    const r = await rpc(
      ids.userAuthority,
      "select public.generate_feedback_targets($1) as r",
      [campaignId],
    );

    expect(r.r.forms).toBeGreaterThan(0);

    const targets = await db.query(
      `select student_id, teacher_id, periods_taught
         from public.feedback_targets where campaign_id = $1 order by teacher_id`,
      [campaignId],
    );

    // Three Class 3 students × two teachers.
    expect(targets.rows).toHaveLength(6);
    for (const row of targets.rows) {
      expect(Number(row.periods_taught)).toBeGreaterThan(0);
    }
  });

  it("reviews BOTH a teacher who left mid-term and their replacement", async () => {
    /*
     * The owner's rule. Teacher Three replaces Teacher One for Bangla in
     * Class 3 halfway through the term, so the assignment that ENDED still
     * produced lessons a student can speak to — and must still be reviewed.
     */
    await db.query(
      `update public.teacher_assignments
          set effective_to = '2026-06-15'
        where teacher_id = $1 and subject_id = $2 and section_id = $3`,
      [ids.teacherOne, ids.subjectBangla, ids.sectionThreeA],
    );

    await db.query(
      `insert into public.teacher_assignments
         (teacher_id, academic_year_id, class_id, section_id, subject_id, effective_from)
       values ($1, $2, $3, $4, $5, '2026-06-16')`,
      [ids.teacherThree, ids.academicYear, ids.classThree, ids.sectionThreeA, ids.subjectBangla],
    );

    await recordLessons(
      ids.teacherThree, ids.subjectBangla, ids.sectionThreeA, ids.classThree, 3, "2026-06-16",
    );

    await rpc(ids.userAuthority, "select public.generate_feedback_targets($1) as r", [
      campaignId,
    ]);

    const banglaTargets = await db.query(
      `select distinct teacher_id
         from public.feedback_targets
        where campaign_id = $1 and subject_id = $2 and student_id = $3`,
      [campaignId, ids.subjectBangla, ids.studentAlpha],
    );

    const reviewed = banglaTargets.rows.map((r) => r.teacher_id).sort();
    expect(
      reviewed,
      "both the outgoing and the incoming Bangla teacher get a form",
    ).toEqual([ids.teacherOne, ids.teacherThree].sort());
  });

  it("a teacher cannot generate forms", async () => {
    await expectRejected(() =>
      rpc(ids.userTeacherOne, "select public.generate_feedback_targets($1) as r", [
        campaignId,
      ]),
    );
  });
});

// ===========================================================================
describe("feedback is anonymous by construction", () => {
  it("has no column linking a rating or comment to a student", async () => {
    const cols = await db.query(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name in ('feedback_responses', 'feedback_comments')
          and column_name like '%student%'`,
    );

    expect(
      cols.rows,
      "a student reference on either table would end the anonymity guarantee",
    ).toHaveLength(0);
  });

  it("stores only the date on a response, never the time", async () => {
    const type = await db.query(
      `select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'feedback_responses'
          and column_name = 'submitted_on'`,
    );

    // A timestamp would let submission order be matched against the
    // completions table, which DOES name students.
    expect(type.rows[0].data_type).toBe("date");
  });

  it("accepts a submission and records completion without the answers", async () => {
    await db.query(
      "update public.feedback_campaigns set status = 'open' where id = $1",
      [campaignId],
    );

    const target = await db.query(
      `select id from public.feedback_targets
        where campaign_id = $1 and student_id = $2 limit 1`,
      [campaignId, ids.studentAlpha],
    );

    const ratings = questionIds.map((id, i) => ({ question_id: id, rating: 4 + (i % 2) }));

    const r = await rpc(
      ids.userStudentAlpha,
      "select public.submit_feedback($1,$2,$3::jsonb,$4) as r",
      [campaignId, target.rows[0].id, JSON.stringify(ratings), "Explains very well."],
    );

    expect(r.r.submitted).toBe(true);

    const responses = await db.query(
      "select count(*)::int as n from public.feedback_responses where campaign_id = $1",
      [campaignId],
    );
    expect(responses.rows[0].n).toBe(questionIds.length);

    const completion = await db.query(
      `select targets_done, targets_total, completed_at
         from public.feedback_completions where campaign_id = $1 and student_id = $2`,
      [campaignId, ids.studentAlpha],
    );
    expect(Number(completion.rows[0].targets_done)).toBe(1);
    // Alpha has a form for each of the three teachers who taught Class 3 this
    // term, so one submission is progress, not completion.
    expect(Number(completion.rows[0].targets_total)).toBeGreaterThan(1);
    expect(completion.rows[0].completed_at).toBeNull();
  });

  it("refuses the same form twice", async () => {
    const target = await db.query(
      `select id from public.feedback_targets
        where campaign_id = $1 and student_id = $2 and answered_at is not null limit 1`,
      [campaignId, ids.studentAlpha],
    );

    const ratings = questionIds.map((id) => ({ question_id: id, rating: 1 }));

    await expectRejected(() =>
      rpc(ids.userStudentAlpha, "select public.submit_feedback($1,$2,$3::jsonb,$4) as r", [
        campaignId, target.rows[0].id, JSON.stringify(ratings), null,
      ]),
    );
  });

  it("refuses a form belonging to another student", async () => {
    const other = await db.query(
      `select id from public.feedback_targets
        where campaign_id = $1 and student_id = $2 limit 1`,
      [campaignId, ids.studentBeta],
    );

    await expectRejected(() =>
      rpc(ids.userStudentAlpha, "select public.submit_feedback($1,$2,$3::jsonb,$4) as r", [
        campaignId,
        other.rows[0].id,
        JSON.stringify(questionIds.map((id) => ({ question_id: id, rating: 3 }))),
        null,
      ]),
    );
  });

  it("refuses a rating outside the question's scale", async () => {
    const target = await db.query(
      `select id from public.feedback_targets
        where campaign_id = $1 and student_id = $2 and answered_at is null limit 1`,
      [campaignId, ids.studentAlpha],
    );

    await expectRejected(() =>
      rpc(ids.userStudentAlpha, "select public.submit_feedback($1,$2,$3::jsonb,$4) as r", [
        campaignId,
        target.rows[0].id,
        JSON.stringify(questionIds.map((id) => ({ question_id: id, rating: 9 }))),
        null,
      ]),
    );
  });

  it("refuses a partial set of answers", async () => {
    const target = await db.query(
      `select id from public.feedback_targets
        where campaign_id = $1 and student_id = $2 and answered_at is null limit 1`,
      [campaignId, ids.studentAlpha],
    );

    await expectRejected(() =>
      rpc(ids.userStudentAlpha, "select public.submit_feedback($1,$2,$3::jsonb,$4) as r", [
        campaignId,
        target.rows[0].id,
        JSON.stringify([{ question_id: questionIds[0], rating: 3 }]),
        null,
      ]),
    );
  });

  it("gives a TEACHER nothing from the responses, comments or analysis", async () => {
    const responses = await rows(
      ids.userTeacherOne,
      "select id from public.feedback_responses where campaign_id = $1",
      [campaignId],
    );
    expect(responses, "a teacher must read no raw ratings").toHaveLength(0);

    const comments = await rows(
      ids.userTeacherOne,
      "select id from public.feedback_comments where campaign_id = $1",
      [campaignId],
    );
    expect(comments, "a teacher must read no comments").toHaveLength(0);

    // The aggregate too: the function guards on app.is_authority() internally,
    // so a teacher gets an empty set rather than their own averages.
    const analysis = await rows(
      ids.userTeacherOne,
      "select * from public.feedback_analysis($1, 3)",
      [campaignId],
    );
    expect(analysis, "a teacher must not read even their own aggregate").toHaveLength(0);
  });

  it("gives a STUDENT nothing from the responses, not even their own", async () => {
    const responses = await rows(
      ids.userStudentAlpha,
      "select id from public.feedback_responses where campaign_id = $1",
      [campaignId],
    );
    expect(responses).toHaveLength(0);
  });

  it("gives the office the aggregate, with a small-sample flag", async () => {
    const analysis = await rows(
      ids.userAuthority,
      "select * from public.feedback_analysis($1, 3)",
      [campaignId],
    );

    expect(analysis.length).toBeGreaterThan(0);
    for (const row of analysis) {
      expect(Number(row.response_count)).toBeGreaterThan(0);
      // One student has answered, so every row is below a floor of three.
      expect(row.below_sample_floor).toBe(true);
    }

    const comments = await rows(
      ids.userAuthority,
      "select body from public.feedback_comments where campaign_id = $1",
      [campaignId],
    );
    expect(comments.length).toBeGreaterThan(0);
  });

  it("names students in the completion overview, which holds no answers", async () => {
    const overview = await rows(
      ids.userAuthority,
      "select * from public.feedback_completion_overview($1, null)",
      [campaignId],
    );

    expect(overview.length).toBeGreaterThan(0);
    const alpha = overview.find((r) => r.student_id === ids.studentAlpha);
    expect(alpha.full_name).toBe("Demo Student Alpha");
    expect(Number(alpha.targets_done)).toBeGreaterThan(0);

    // And a teacher gets nothing from it.
    const asTeacher = await rows(
      ids.userTeacherOne,
      "select * from public.feedback_completion_overview($1, null)",
      [campaignId],
    );
    expect(asTeacher).toHaveLength(0);
  });
});

// ===========================================================================
describe("admit card eligibility is enforced in one place", () => {
  it("blocks the card when no rule is configured", async () => {
    const r = await rpc(
      ids.userAuthority,
      "select public.admit_card_eligibility($1,$2) as r",
      [ids.studentAlpha, examId],
    );

    expect(r.r.eligible).toBe(false);
    expect(r.r.blocks).toContain("no_rule_configured");
  });

  it("defaults the fee cutoff to the exam's own month, as the owner chose", async () => {
    const r = await rpc(
      ids.userAuthority,
      "select public.default_admit_card_rule($1) as r",
      [examId],
    );

    // The exam starts 2026-06-01, so the cutoff is June 2026 — not May.
    expect(Number(r.r.fees_cleared_through_year)).toBe(2026);
    expect(Number(r.r.fees_cleared_through_month)).toBe(6);
    expect(r.r.require_feedback).toBe(true);
    expect(r.r.require_exam_fee_paid).toBe(true);
    expect(Number(r.r.allowed_outstanding)).toBe(0);
    expect(r.r.allow_override, "exceptions stay off until the owner says otherwise")
      .toBe(false);
  });

  it("blocks on incomplete feedback", async () => {
    const r = await rpc(
      ids.userAuthority,
      "select public.admit_card_eligibility($1,$2) as r",
      [ids.studentAlpha, examId],
    );

    // Alpha answered one form of several, so the campaign is unfinished.
    expect(r.r.blocks).toContain("feedback_incomplete");
    expect(r.r.eligible).toBe(false);
  });

  it("blocks on fees outstanding through the exam's month", async () => {
    // The seed bills monthly tuition, so there is something outstanding.
    const r = await rpc(
      ids.userAuthority,
      "select public.admit_card_eligibility($1,$2) as r",
      [ids.studentAlpha, examId],
    );

    expect(Number(r.r.outstanding_monthly)).toBeGreaterThan(0);
    expect(r.r.blocks).toContain("monthly_fees_outstanding");
  });

  it("refuses to issue a blocked card — to the office as well as the student", async () => {
    await expectRejected(() =>
      rpc(ids.userAuthority, "select public.issue_admit_card($1,$2) as r", [
        ids.studentAlpha, examId,
      ]),
    );

    await expectRejected(() =>
      rpc(ids.userStudentAlpha, "select public.issue_admit_card($1,$2) as r", [
        ids.studentAlpha, examId,
      ]),
    );
  });

  it("refuses an exception while the owner has overrides switched off", async () => {
    await expectRejected(() =>
      rpc(ids.userAuthority, "select public.override_admit_card($1,$2,$3) as r", [
        ids.studentAlpha, examId, "guardian hospitalised",
      ]),
    );
  });

  it("issues once every requirement is met, with a stable seat code", async () => {
    // Clear the blocks: finish the feedback and settle the fees.
    await db.query(
      `update public.feedback_completions
          set targets_done = targets_total, completed_at = now()
        where campaign_id = $1 and student_id = $2`,
      [campaignId, ids.studentAlpha],
    );
    await db.query(
      `update public.fee_charges
          set status = 'paid', amount_paid = amount
        where student_id = $1`,
      [ids.studentAlpha],
    );

    const elig = await rpc(
      ids.userAuthority,
      "select public.admit_card_eligibility($1,$2) as r",
      [ids.studentAlpha, examId],
    );
    expect(elig.r.eligible, JSON.stringify(elig.r.blocks)).toBe(true);

    const first = await rpc(ids.userAuthority, "select public.issue_admit_card($1,$2) as r", [
      ids.studentAlpha, examId,
    ]);
    expect(first.r.seat_token).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);

    // Re-issuing reprints the SAME code, because the student may already hold
    // a card carrying it.
    const second = await rpc(ids.userAuthority, "select public.issue_admit_card($1,$2) as r", [
      ids.studentAlpha, examId,
    ]);
    expect(second.r.seat_token).toBe(first.r.seat_token);
  });

  it("a teacher cannot issue an admit card for a student they teach", async () => {
    await expectRejected(() =>
      rpc(ids.userTeacherOne, "select public.issue_admit_card($1,$2) as r", [
        ids.studentAlpha, examId,
      ]),
    );
  });

  it("gives the office an overview and a teacher nothing", async () => {
    const office = await rows(
      ids.userAuthority,
      "select * from public.exam_admit_overview($1, null)",
      [examId],
    );
    expect(office.length).toBeGreaterThan(0);

    const teacher = await rows(
      ids.userTeacherOne,
      "select * from public.exam_admit_overview($1, null)",
      [examId],
    );
    expect(teacher).toHaveLength(0);
  });
});

// ===========================================================================
describe("admit card data carries its own verdict", () => {
  it("includes the subject timetable, the seat code and the eligibility", async () => {
    const r = await rpc(ids.userAuthority, "select public.admit_card_data($1,$2) as r", [
      ids.studentAlpha, examId,
    ]);

    expect(r.r.student.registration_no).toBe("STU-2026-0001");
    expect(r.r.subjects).toHaveLength(2);
    expect(r.r.seat_token).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(r.r.eligibility.eligible).toBe(true);
  });

  it("lets a student read their own and refuses a classmate's", async () => {
    const own = await rpc(
      ids.userStudentAlpha,
      "select public.admit_card_data($1,$2) as r",
      [ids.studentAlpha, examId],
    );
    expect(own.r.student.registration_no).toBe("STU-2026-0001");

    await expectRejected(() =>
      rpc(ids.userStudentAlpha, "select public.admit_card_data($1,$2) as r", [
        ids.studentBeta, examId,
      ]),
    );
  });
});

// ===========================================================================
describe("the public QR card shows only what the card prints", () => {
  let tokenId;
  const TOKEN = "phase6-test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("copies only the template's declared fields into the snapshot", async () => {
    const r = await rpc(ids.userAuthority, "select public.issue_qr_token($1,$2,$3,$4) as r", [
      ids.studentAlpha, TOKEN, ID_TEMPLATE_PORTRAIT, null,
    ]);

    tokenId = r.r.qr_token_id;

    const snap = await db.query(
      "select card_snapshot from public.qr_tokens where id = $1",
      [tokenId],
    );
    const keys = Object.keys(snap.rows[0].card_snapshot);

    // What the owner chose to print, including the guardian's number.
    expect(keys).toContain("full_name");
    expect(keys).toContain("registration_no");
    expect(keys).toContain("class_name");
    expect(keys).toContain("blood_group");
    expect(keys).toContain("guardian_phone");

    // What must never be there, whatever a template asks for.
    for (const forbidden of [
      "father_name", "mother_name", "father_nid", "mother_nid",
      "birth_certificate_no", "fees", "marks", "gpa", "attendance",
    ]) {
      expect(keys, `${forbidden} must not reach the public snapshot`).not.toContain(forbidden);
    }
  });

  it("refuses a snapshot carrying a forbidden key, whatever writes it", async () => {
    // Defence in depth: the trigger, not the template, is the guarantee.
    await expectRejected(() =>
      db.query(
        `insert into public.qr_tokens (token, student_id, card_snapshot)
         values ($1, $2, $3::jsonb)`,
        [
          "forbidden-key-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          ids.studentAlpha,
          JSON.stringify({ full_name: "X", father_name: "Should be refused" }),
        ],
      ),
    );
  });

  it("resolves for an anonymous visitor and returns school contact details", async () => {
    const card = await asAnon(db, async () =>
      (await db.query("select public.get_public_card($1) as r", [TOKEN])).rows[0],
    );

    expect(card.r.card.full_name).toBe("Demo Student Alpha");
    expect(card.r.school.name).toBeTruthy();
    expect(card.r.school.office_phone).toBeTruthy();
    // Nothing beyond the snapshot and the school block.
    expect(Object.keys(card.r).sort()).toEqual(["card", "issued_at", "school"]);
  });

  it("an anonymous visitor can read nothing else", async () => {
    /*
     * `anon` holds no table privileges at all (migration 0019), so these fail
     * with "permission denied" rather than returning an empty set. Asserting
     * rejection is therefore the stronger check: it proves the grant is absent,
     * not merely that a policy filtered the rows.
     */
    await expectRejected(() =>
      asAnon(db, async () => db.query("select id from public.qr_tokens")),
    );
    await expectRejected(() =>
      asAnon(db, async () => db.query("select id from public.exam_seat_tokens")),
    );

    // Nor can anon execute the new functions.
    await expectRejected(() =>
      asAnon(db, async () =>
        db.query("select public.admit_card_data($1,$2)", [ids.studentAlpha, examId]),
      ),
    );
    await expectRejected(() =>
      asAnon(db, async () => db.query("select app.seat_token_code()")),
    );
  });

  it("revokes the previous card when a replacement is issued", async () => {
    const replacement = "phase6-replacement-token-cccccccccccccccccccc";

    const r = await rpc(ids.userAuthority, "select public.issue_qr_token($1,$2,$3,$4) as r", [
      ids.studentAlpha, replacement, ID_TEMPLATE_LANDSCAPE, "card lost",
    ]);

    expect(r.r.replaced_previous).toBe(true);

    const old = await db.query(
      "select revoked_at, revoke_reason, replaced_by_id from public.qr_tokens where id = $1",
      [tokenId],
    );
    expect(old.rows[0].revoked_at).not.toBeNull();
    expect(old.rows[0].revoke_reason).toBe("card lost");
    expect(old.rows[0].replaced_by_id).toBe(r.r.qr_token_id);

    // The old link stops resolving for the public.
    const dead = await asAnon(db, async () =>
      (await db.query("select public.get_public_card($1) as r", [TOKEN])).rows[0],
    );
    expect(dead.r, "a revoked card must stop resolving").toBeNull();

    // The replacement works.
    const live = await asAnon(db, async () =>
      (await db.query("select public.get_public_card($1) as r", [replacement])).rows[0],
    );
    expect(live.r.card.full_name).toBe("Demo Student Alpha");

    tokenId = r.r.qr_token_id;
  });

  it("holds at most one live card per student", async () => {
    await expectRejected(() =>
      db.query(
        `insert into public.qr_tokens (token, student_id, card_snapshot)
         values ($1, $2, '{"full_name":"X"}'::jsonb)`,
        ["second-live-token-dddddddddddddddddddddddddddd", ids.studentAlpha],
      ),
    );
  });

  it("revoking requires a reason, and a revoked card cannot be revoked twice", async () => {
    await expectRejected(() =>
      rpc(ids.userAuthority, "select public.revoke_qr_token($1,$2) as r", [tokenId, "  "]),
    );

    const r = await rpc(ids.userAuthority, "select public.revoke_qr_token($1,$2) as r", [
      tokenId, "student left the school",
    ]);
    expect(r.r.revoked).toBe(tokenId);

    await expectRejected(() =>
      rpc(ids.userAuthority, "select public.revoke_qr_token($1,$2) as r", [
        tokenId, "again",
      ]),
    );
  });

  it("a teacher cannot issue or revoke a card", async () => {
    await expectRejected(() =>
      rpc(ids.userTeacherOne, "select public.issue_qr_token($1,$2,$3,$4) as r", [
        ids.studentAlpha, "teacher-issued-token-eeeeeeeeeeeeeeeeeeeeee",
        ID_TEMPLATE_PORTRAIT, null,
      ]),
    );
  });

  it("refuses a token short enough to guess", async () => {
    await expectRejected(() =>
      rpc(ids.userAuthority, "select public.issue_qr_token($1,$2,$3,$4) as r", [
        ids.studentBeta, "tooshort", ID_TEMPLATE_PORTRAIT, null,
      ]),
    );
  });

  it("offers both orientations at PVC dimensions", async () => {
    const templates = await db.query(
      `select name, orientation, config from public.document_templates
        where kind = 'id_card' order by orientation`,
    );

    expect(templates.rows).toHaveLength(2);

    const landscape = templates.rows.find((t) => t.orientation === "landscape");
    const portrait = templates.rows.find((t) => t.orientation === "portrait");

    // CR80, the bank-card size.
    expect(Number(portrait.config.width_mm)).toBe(54);
    expect(Number(portrait.config.height_mm)).toBe(85.6);
    expect(Number(landscape.config.width_mm)).toBe(85.6);
    expect(Number(landscape.config.height_mm)).toBe(54);

    // The owner's field decision: guardian number on the front, school number
    // on the back.
    expect(portrait.config.front_fields).toContain("guardian_phone");
    expect(portrait.config.back_fields).toContain("office_phone");
    expect(portrait.config.back_fields).not.toContain("guardian_phone");
  });
});

// ===========================================================================
describe("the printable exam routine and result sheet", () => {
  it("hides an unpublished routine from a student and shows it to staff", async () => {
    const asStudent = await rpc(
      ids.userStudentAlpha, "select public.exam_routine_data($1) as r", [examId],
    );
    expect(asStudent.r, "a student sees nothing before the routine is published")
      .toBeNull();

    const asOffice = await rpc(
      ids.userAuthority, "select public.exam_routine_data($1) as r", [examId],
    );
    expect(asOffice.r.rows).toHaveLength(2);
    expect(asOffice.r.exam.routine_published_at).toBeNull();
  });

  it("shows the routine to a student once published", async () => {
    await db.query(
      "update public.exams set routine_published_at = now() where id = $1",
      [examId],
    );

    const asStudent = await rpc(
      ids.userStudentAlpha, "select public.exam_routine_data($1) as r", [examId],
    );
    expect(asStudent.r.rows).toHaveLength(2);
  });

  it("has nothing to print until results are published", async () => {
    const r = await rpc(
      ids.userAuthority, "select public.result_sheet_data($1,null,null) as r", [examId],
    );
    expect(r.r, "an unpublished exam yields no result sheet at all").toBeNull();
  });

  it("prints only the caller's own sheet for a student", async () => {
    // Publish: enter every mark, then run the real publish function.
    const subjects = await db.query(
      "select id from public.exam_subjects where exam_id = $1", [examId],
    );
    const roster = [ids.studentAlpha, ids.studentBeta, EPSILON];

    await db.query("update public.exams set status = 'marks_open' where id = $1", [examId]);

    for (const s of subjects.rows) {
      for (const student of roster) {
        await db.query(
          `insert into public.marks (exam_subject_id, student_id, marks_obtained, entered_at)
           values ($1, $2, 70, now())`,
          [s.id, student],
        );
      }
    }

    await rpc(ids.userAuthority, "select public.publish_results($1) as r", [examId]);

    const own = await rpc(
      ids.userStudentAlpha, "select public.result_sheet_data($1,null,null) as r", [examId],
    );
    expect(own.r.sheets, "a student's download carries one sheet, theirs").toHaveLength(1);
    expect(own.r.sheets[0].registration_no).toBe("STU-2026-0001");

    // Asking for a classmate by id returns nothing rather than their sheet.
    const other = await rpc(
      ids.userStudentAlpha,
      "select public.result_sheet_data($1,$2,null) as r",
      [examId, ids.studentBeta],
    );
    expect(other.r.sheets).toHaveLength(0);

    // The office gets the whole section.
    const office = await rpc(
      ids.userAuthority, "select public.result_sheet_data($1,null,null) as r", [examId],
    );
    expect(office.r.sheets).toHaveLength(3);
    expect(office.r.exam.results_published_at).not.toBeNull();
  });

  it("gives a teacher only the students they teach", async () => {
    // Teacher Three teaches Class 8 English and, since the mid-term change,
    // Class 3 Bangla — so they see the Class 3 cohort and not Class 8's.
    const taught = await rpc(
      ids.userTeacherTwo, "select public.result_sheet_data($1,null,null) as r", [examId],
    );
    expect(taught.r.sheets).toHaveLength(3);

    // The elder sibling is in Class 8 and sat no part of this exam.
    const names = taught.r.sheets.map((s) => s.registration_no);
    expect(names).not.toContain("STU-2026-0003");
  });
});
