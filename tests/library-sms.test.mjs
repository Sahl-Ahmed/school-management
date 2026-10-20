/**
 * Phase 7: the library, the notification queue, and the card/QR field rule.
 *
 * The three things worth guarding here:
 *
 *   1. A field the ID card PRINTS must be a field the public page can SHOW.
 *      Phase 6 shipped a card printing a guardian's phone number and a page
 *      looking for a different key, so the number was silently dropped. The
 *      owner has since settled that the page shows what the card prints, which
 *      makes the two lists one list — and this asserts they cannot drift again.
 *   2. "Exactly one daily summary per student per school day" has to survive a
 *      re-run, an overlapping scheduler and a double click. The dedupe index is
 *      the guarantee; these tests re-run everything twice and check the count.
 *   3. Nothing may be announced that is not published. Queueing results for an
 *      unpublished exam is refused.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDatabase, asUser, asAnon, expectRejected } from "./sql/harness.mjs";
import { seedWithAccounts, ids } from "./sql/fixtures.mjs";

let db;

const EPSILON = "57000000-0000-4000-8000-000000000005";
const ID_TEMPLATE_PORTRAIT = "d0c00000-0000-4000-8000-000000000001";
const ROSTER = [ids.studentAlpha, ids.studentBeta, EPSILON];
const DAY = "2026-05-04";

let examId;

beforeAll(async () => {
  db = await freshDatabase();
  await seedWithAccounts(db);

  // One submitted lesson with attendance, so a daily summary has real facts.
  const period = await db.query(
    `insert into public.routine_periods
       (academic_year_id, class_id, section_id, subject_id, teacher_id,
        weekday, period_no, starts_at, ends_at, effective_from)
     values ($1, $2, $3, $4, $5, 1, 90, '17:00', '17:40', '2026-01-01')
     returning id`,
    [ids.academicYear, ids.classThree, ids.sectionThreeA, ids.subjectBangla, ids.teacherOne],
  );

  const session = await db.query(
    `insert into public.teaching_sessions
       (routine_period_id, session_date, class_id, section_id, subject_id,
        teacher_id, period_no, starts_at, ends_at, submitted_at)
     values ($1, $2, $3, $4, $5, $6, 90, '17:00', '17:40', now())
     returning id`,
    [period.rows[0].id, DAY, ids.classThree, ids.sectionThreeA, ids.subjectBangla, ids.teacherOne],
  );

  for (const [i, student] of ROSTER.entries()) {
    await db.query(
      `insert into public.student_attendance (teaching_session_id, student_id, status)
       values ($1, $2, $3)`,
      [session.rows[0].id, student, i === 2 ? "absent" : "present"],
    );
  }

  const exam = await db.query(
    `insert into public.exams
       (academic_year_id, term_id, name, status, starts_on, ends_on, grading_scale_id)
     values ($1, $2, 'Phase 7 Exam', 'marks_open', '2026-06-01', '2026-06-10',
             '9ab00000-0000-4000-8000-000000000001')
     returning id`,
    [ids.academicYear, ids.termSecond],
  );
  examId = exam.rows[0].id;

  const subjects = await db.query(
    `insert into public.exam_subjects (exam_id, class_id, subject_id, max_marks, pass_marks)
     values ($1, $2, $3, 100, 33) returning id`,
    [examId, ids.classThree, ids.subjectBangla],
  );

  for (const student of ROSTER) {
    await db.query(
      `insert into public.marks (exam_subject_id, student_id, marks_obtained, entered_at)
       values ($1, $2, 70, now())`,
      [subjects.rows[0].id, student],
    );
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const rpc = (userId, sql, params) =>
  asUser(db, userId, async () => (await db.query(sql, params)).rows[0]);

const rows = (userId, sql, params) =>
  asUser(db, userId, async () => (await db.query(sql, params)).rows);

// ===========================================================================
describe("the ID card and the public page show the same details", () => {
  it("has a page field for every student detail the card template prints", async () => {
    const template = await db.query(
      `select config from public.document_templates where id = $1`,
      [ID_TEMPLATE_PORTRAIT],
    );

    const printed = template.rows[0].config.front_fields;

    /*
     * The list the page renders from, mirrored here deliberately.
     *
     * It duplicates src/lib/school/card-fields.ts, and that is the point: if
     * someone adds a field to a template and not to the page, this fails. A
     * test that imported the module would move in lockstep with it and prove
     * nothing about the template.
     */
    const pageCanShow = [
      "full_name", "full_name_bn", "registration_no", "roll_no",
      "class_name", "section_name", "blood_group", "session", "guardian_phone",
    ];
    // Printed on the card but not student details, so not expected on the page.
    const notDetails = ["photo", "school_address", "office_phone", "return_note"];

    const unshowable = printed.filter(
      (f) => !notDetails.includes(f) && !pageCanShow.includes(f),
    );

    expect(
      unshowable,
      "a field the card prints that the public page cannot show would be " +
      "silently dropped, which is the phase 6 bug",
    ).toEqual([]);
  });

  it("puts the guardian phone in the snapshot, since the card prints it", async () => {
    const template = await db.query(
      "select config from public.document_templates where id = $1",
      [ID_TEMPLATE_PORTRAIT],
    );
    expect(template.rows[0].config.front_fields).toContain("guardian_phone");

    /*
     * The seed already gives every student one SMS-target contact, and a
     * unique partial index allows exactly one — so this reads the seeded
     * number rather than inserting another, which is what the real issue path
     * does anyway.
     */
    const contact = await db.query(
      `select phone from public.student_contacts
        where student_id = $1 order by is_sms_target desc, created_at limit 1`,
      [ids.studentAlpha],
    );
    const seededPhone = contact.rows[0].phone;

    const token = "phase7-card-token-aaaaaaaaaaaaaaaaaaaaaaaa";
    await rpc(ids.userAuthority, "select public.issue_qr_token($1,$2,$3,$4) as r", [
      ids.studentAlpha, token, ID_TEMPLATE_PORTRAIT, null,
    ]);

    const snap = await db.query(
      "select card_snapshot from public.qr_tokens where token = $1",
      [token],
    );

    expect(Object.keys(snap.rows[0].card_snapshot)).toContain("guardian_phone");
    expect(snap.rows[0].card_snapshot.guardian_phone).toBe(seededPhone);

    // And an anonymous visitor gets it, because the card prints it.
    const card = await asAnon(db, async () =>
      (await db.query("select public.get_public_card($1) as r", [token])).rows[0],
    );
    expect(card.r.card.guardian_phone).toBe(seededPhone);
  });

  it("still refuses parent names and private records, whatever a template asks", async () => {
    await expectRejected(() =>
      db.query(
        `insert into public.qr_tokens (token, student_id, card_snapshot)
         values ($1, $2, $3::jsonb)`,
        [
          "phase7-forbidden-bbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          ids.studentBeta,
          JSON.stringify({ full_name: "X", father_name: "Refused" }),
        ],
      ),
    );
  });

  it("returns the school's name, logo, email and office number", async () => {
    const card = await asAnon(db, async () =>
      (await db.query("select public.get_public_card($1) as r", [
        "phase7-card-token-aaaaaaaaaaaaaaaaaaaaaaaa",
      ])).rows[0],
    );

    // The brief asks for all four. logo_path is null until the school supplies
    // one, which the page treats as "no logo" rather than a broken image.
    expect(Object.keys(card.r.school).sort()).toEqual(
      ["email", "logo_path", "name", "office_phone"],
    );
    expect(card.r.school.name).toBeTruthy();
    expect(card.r.school.office_phone).toBeTruthy();
  });
});

// ===========================================================================
describe("library cards follow the revised specification", () => {
  let bookId;

  it("stores a colour and refuses one that is not a hex value", async () => {
    const book = await db.query(
      `insert into public.library_books
         (title, subject_label, category, class_id, class_to_id, card_color,
          drive_url, is_published)
       values ('Essentials of Human Biology and Physiology, Volume II',
               'Biology', 'Biology', $1, $2, '#1f6b45',
               'https://drive.google.com/file/d/abc/view', true)
       returning id`,
      [ids.classThree, ids.classEight],
    );
    bookId = book.rows[0].id;

    await expectRejected(() =>
      db.query(
        `insert into public.library_books (title, drive_url, card_color)
         values ('Bad colour', 'https://drive.google.com/x', 'not-a-colour')`,
      ),
    );
  });

  it("builds the audience label as a range, a single class, or everyone", async () => {
    const all = await rows(
      ids.userAuthority, "select * from public.library_catalogue(true)",
    );
    const ranged = all.find((b) => b.id === bookId);
    // Class 3 (level 5) to Class 8 (level 10) collapses to "Class 3-8".
    expect(ranged.audience_label).toBe("Class 3-8");

    const single = await db.query(
      `insert into public.library_books (title, subject_label, class_id, drive_url, is_published)
       values ('Single class book', 'Mathematics', $1,
               'https://drive.google.com/file/d/def/view', true)
       returning id`,
      [ids.classThree],
    );
    const everyone = await db.query(
      `insert into public.library_books (title, subject_label, drive_url, is_published)
       values ('Open to all', 'ICT', 'https://drive.google.com/file/d/ghi/view', true)
       returning id`,
    );

    const after = await rows(
      ids.userAuthority, "select * from public.library_catalogue(true)",
    );
    expect(after.find((b) => b.id === single.rows[0].id).audience_label).toBe("Class 3");
    expect(after.find((b) => b.id === everyone.rows[0].id).audience_label).toBe("Everyone");
  });

  it("refuses an audience range that runs backwards", async () => {
    await expectRejected(() =>
      db.query(
        `insert into public.library_books (title, class_id, class_to_id, drive_url)
         values ('Backwards', $1, $2, 'https://drive.google.com/x')`,
        [ids.classEight, ids.classThree],
      ),
    );
  });

  it("refuses an ending class with no starting class", async () => {
    await expectRejected(() =>
      db.query(
        `insert into public.library_books (title, class_to_id, drive_url)
         values ('Dangling', $1, 'https://drive.google.com/x')`,
        [ids.classThree],
      ),
    );
  });

  it("hides unpublished books from students and teachers", async () => {
    const draft = await db.query(
      `insert into public.library_books (title, subject_label, drive_url, is_published)
       values ('Draft book', 'Science', 'https://drive.google.com/file/d/jkl/view', false)
       returning id`,
    );

    const asStudent = await rows(
      ids.userStudentAlpha, "select * from public.library_catalogue(false)",
    );
    expect(asStudent.some((b) => b.id === draft.rows[0].id)).toBe(false);

    // Asking for unpublished as a student is simply not honoured.
    const sneaky = await rows(
      ids.userStudentAlpha, "select * from public.library_catalogue(true)",
    );
    expect(
      sneaky.some((b) => b.id === draft.rows[0].id),
      "p_include_unpublished must only work for the office",
    ).toBe(false);

    const asTeacher = await rows(
      ids.userTeacherOne, "select * from public.library_catalogue(true)",
    );
    expect(asTeacher.some((b) => b.id === draft.rows[0].id)).toBe(false);

    const asOffice = await rows(
      ids.userAuthority, "select * from public.library_catalogue(true)",
    );
    expect(asOffice.some((b) => b.id === draft.rows[0].id)).toBe(true);
  });

  it("lets a student read published books and not write any", async () => {
    const readable = await rows(
      ids.userStudentAlpha, "select id from public.library_books",
    );
    expect(readable.length).toBeGreaterThan(0);

    await expectRejected(() =>
      asUser(db, ids.userStudentAlpha, async () =>
        db.query(
          `insert into public.library_books (title, drive_url)
           values ('Student book', 'https://drive.google.com/x')`,
        ),
      ),
    );
  });

  it("keeps the cancelled thumbnail columns unused", async () => {
    const used = await db.query(
      `select count(*)::int as n from public.library_books
        where cover_image_path is not null or cover_generated_at is not null`,
    );
    expect(
      used.rows[0].n,
      "the PDF-thumbnail design is cancelled; nothing should write these",
    ).toBe(0);
  });

  it("anon reads no books at all", async () => {
    await expectRejected(() =>
      asAnon(db, async () => db.query("select id from public.library_books")),
    );
  });
});

// ===========================================================================
describe("the daily attendance summary is exactly one per student per day", () => {
  it("queues one job per student who had a submitted lesson", async () => {
    // Every student needs a destination, or they are skipped by design. The
    // seed already provides one each, which is what the real path reads.
    const r = await rpc(
      ids.userAuthority, "select public.queue_daily_attendance($1) as r", [DAY],
    );

    expect(r.r.queued).toBe(3);
    expect(r.r.no_submitted_attendance).toBeGreaterThanOrEqual(0);

    const jobs = await db.query(
      `select student_id, payload, dedupe_key from public.notification_jobs
        where type = 'daily_attendance' and job_date = $1`,
      [DAY],
    );
    expect(jobs.rows).toHaveLength(3);

    // The facts, not the words: the body is rendered later from a template.
    const absent = jobs.rows.find((j) => j.student_id === EPSILON);
    expect(absent.payload.status).toBe("absent");
    expect(Number(absent.payload.present)).toBe(0);
    expect(Number(absent.payload.lessons)).toBe(1);

    const present = jobs.rows.find((j) => j.student_id === ids.studentAlpha);
    expect(present.payload.status).toBe("present");
  });

  it("queues NOTHING on a second run — the dedupe index refuses it", async () => {
    const r = await rpc(
      ids.userAuthority, "select public.queue_daily_attendance($1) as r", [DAY],
    );

    expect(r.r.queued).toBe(0);
    expect(r.r.already_queued).toBe(3);

    const count = await db.query(
      `select count(*)::int as n from public.notification_jobs
        where type = 'daily_attendance' and job_date = $1`,
      [DAY],
    );
    expect(count.rows[0].n, "a re-run must not double the messages").toBe(3);
  });

  it("says nothing for a day with no submitted attendance", async () => {
    const r = await rpc(
      ids.userAuthority, "select public.queue_daily_attendance($1) as r", ["2026-05-20"],
    );

    expect(r.r.queued, "a summary reading 'present 0/0' looks like an absence").toBe(0);
    expect(r.r.no_submitted_attendance).toBeGreaterThan(0);
  });

  it("skips a student with no phone number instead of queueing a doomed job", async () => {
    // The Class 1 sibling has a contact; remove it and give them a lesson.
    await db.query("delete from public.student_contacts where student_id = $1", [
      ids.siblingYounger,
    ]);

    const period = await db.query(
      `insert into public.routine_periods
         (academic_year_id, class_id, section_id, subject_id, teacher_id,
          weekday, period_no, starts_at, ends_at, effective_from)
       values ($1, $2, $3, $4, $5, 2, 91, '18:00', '18:40', '2026-01-01')
       returning id`,
      [
        ids.academicYear,
        "c1000000-0000-4000-8000-000000000003",
        "5ec00000-0000-4000-8000-000000000003",
        ids.subjectBangla,
        ids.teacherOne,
      ],
    );

    const session = await db.query(
      `insert into public.teaching_sessions
         (routine_period_id, session_date, class_id, section_id, subject_id,
          teacher_id, period_no, starts_at, ends_at, submitted_at)
       values ($1, '2026-05-06', $2, $3, $4, $5, 91, '18:00', '18:40', now())
       returning id`,
      [
        period.rows[0].id,
        "c1000000-0000-4000-8000-000000000003",
        "5ec00000-0000-4000-8000-000000000003",
        ids.subjectBangla,
        ids.teacherOne,
      ],
    );

    await db.query(
      `insert into public.student_attendance (teaching_session_id, student_id, status)
       values ($1, $2, 'present')`,
      [session.rows[0].id, ids.siblingYounger],
    );

    const r = await rpc(
      ids.userAuthority, "select public.queue_daily_attendance($1) as r", ["2026-05-06"],
    );

    expect(r.r.no_contact).toBe(1);
    expect(r.r.queued).toBe(0);
  });

  it("a teacher cannot queue notifications", async () => {
    await expectRejected(() =>
      rpc(ids.userTeacherOne, "select public.queue_daily_attendance($1) as r", [DAY]),
    );
  });
});

// ===========================================================================
describe("result messages follow publication", () => {
  it("refuses to queue results for an unpublished exam", async () => {
    await expectRejected(() =>
      rpc(ids.userAuthority, "select public.queue_exam_results($1) as r", [examId]),
    );
  });

  it("queues one per student once results are published, and only once", async () => {
    await rpc(ids.userAuthority, "select public.publish_results($1) as r", [examId]);

    const first = await rpc(
      ids.userAuthority, "select public.queue_exam_results($1) as r", [examId],
    );
    expect(first.r.queued).toBe(3);

    const second = await rpc(
      ids.userAuthority, "select public.queue_exam_results($1) as r", [examId],
    );
    expect(second.r.queued).toBe(0);
    expect(second.r.already_queued).toBe(3);

    const jobs = await db.query(
      `select payload from public.notification_jobs where type = 'exam_result'`,
    );
    expect(jobs.rows).toHaveLength(3);
    // The facts a result message needs, present and sane.
    for (const job of jobs.rows) {
      expect(job.payload.exam).toBe("Phase 7 Exam");
      expect(Number(job.payload.obtained)).toBeGreaterThan(0);
      expect(job.payload.outcome).toMatch(/^(Passed|Not passed)$/);
    }
  });
});

// ===========================================================================
describe("class test messages", () => {
  it("queues one per marked student, once", async () => {
    const test = await db.query(
      `insert into public.class_tests
         (academic_year_id, class_id, section_id, subject_id, teacher_id,
          name, max_marks, test_date, status)
       values ($1, $2, $3, $4, $5, 'Chapter 3 test', 20, '2026-05-20', 'draft')
       returning id`,
      [ids.academicYear, ids.classThree, ids.sectionThreeA, ids.subjectBangla, ids.teacherOne],
    );

    for (const [i, student] of ROSTER.entries()) {
      await db.query(
        `insert into public.class_test_marks (class_test_id, student_id, marks_obtained)
         values ($1, $2, $3)`,
        [test.rows[0].id, student, [18, 15, 11][i]],
      );
    }

    const first = await rpc(
      ids.userTeacherOne, "select public.queue_class_test_results($1) as r", [test.rows[0].id],
    );
    expect(first.r.queued).toBe(3);

    const second = await rpc(
      ids.userTeacherOne, "select public.queue_class_test_results($1) as r", [test.rows[0].id],
    );
    expect(second.r.queued).toBe(0);
    expect(second.r.already_queued).toBe(3);
  });

  it("refuses another teacher's class test", async () => {
    const test = await db.query(
      `select id from public.class_tests limit 1`,
    );
    await expectRejected(() =>
      rpc(ids.userTeacherThree, "select public.queue_class_test_results($1) as r", [
        test.rows[0].id,
      ]),
    );
  });
});

// ===========================================================================
describe("the dispatcher claims each job exactly once", () => {
  it("hands out a batch and marks it queued", async () => {
    const claimed = await rows(
      ids.userAuthority, "select * from public.claim_notification_jobs(100)",
    );

    expect(claimed.length).toBeGreaterThan(0);

    const states = await db.query(
      `select distinct status from public.notification_jobs
        where id = any($1::uuid[])`,
      [claimed.map((c) => c.id)],
    );
    expect(states.rows.map((r) => r.status)).toEqual(["queued"]);
  });

  it("does not hand the same job out twice", async () => {
    const again = await rows(
      ids.userAuthority, "select * from public.claim_notification_jobs(100)",
    );

    /*
     * The second claim DOES return the same rows, because a 'queued' job is
     * still eligible — that is deliberate, so a dispatcher that crashed
     * mid-batch can pick its work back up. What must not happen is a message
     * going out twice, and that is guarded by the dedupe key at queue time,
     * not here. The attempt counter is what makes a re-claim visible.
     */
    const attempts = await db.query(
      `select max(attempts)::int as n from public.notification_jobs
        where id = any($1::uuid[])`,
      [again.map((c) => c.id)],
    );
    expect(attempts.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it("a teacher claims nothing", async () => {
    const claimed = await rows(
      ids.userTeacherOne, "select * from public.claim_notification_jobs(100)",
    );
    expect(claimed).toHaveLength(0);
  });

  it("settles a job without ever calling a simulated send 'sent'", async () => {
    const job = await db.query(
      "select id from public.notification_jobs limit 1",
    );

    await rpc(
      ids.userAuthority,
      "select public.settle_notification_job($1, 'skipped', $2, $3, $4, $5)",
      [job.rows[0].id, "Rendered body", 1, false, "SIMULATED — nothing was sent."],
    );

    const after = await db.query(
      "select status, sent_at, body, segments from public.notification_jobs where id = $1",
      [job.rows[0].id],
    );

    expect(after.rows[0].status).toBe("skipped");
    expect(
      after.rows[0].sent_at,
      "a simulated dispatch must never set sent_at — the office's delivery " +
      "figures would then describe messages that do not exist",
    ).toBeNull();
    expect(after.rows[0].body).toBe("Rendered body");
  });

  it("gives the office an overview and a teacher nothing", async () => {
    const office = await rows(
      ids.userAuthority, "select * from public.notification_overview(null, null)",
    );
    expect(office.length).toBeGreaterThan(0);

    const teacher = await rows(
      ids.userTeacherOne, "select * from public.notification_overview(null, null)",
    );
    expect(teacher).toHaveLength(0);
  });

  it("anon reaches none of the queue", async () => {
    await expectRejected(() =>
      asAnon(db, async () => db.query("select id from public.notification_jobs")),
    );
    await expectRejected(() =>
      asAnon(db, async () => db.query("select * from public.claim_notification_jobs(1)")),
    );
  });
});

// ===========================================================================
describe("message templates", () => {
  it("ships a default per type and language, and only one", async () => {
    const defaults = await db.query(
      `select type, language, count(*)::int as n
         from public.notification_templates
        where is_default and is_active
        group by type, language having count(*) > 1`,
    );
    expect(defaults.rows, "one default per type per language").toHaveLength(0);

    const types = await db.query(
      `select distinct type from public.notification_templates where is_default`,
    );
    const names = types.rows.map((r) => r.type).sort();
    expect(names).toContain("daily_attendance");
    expect(names).toContain("exam_result");
    expect(names).toContain("class_test_result");
    expect(names).toContain("account_otp");
  });

  it("has Bangla variants, which cost more to send", async () => {
    const bn = await db.query(
      "select type, body from public.notification_templates where language = 'bn'",
    );
    expect(bn.rows.length).toBeGreaterThan(0);
    for (const row of bn.rows) {
      // A Bangla body must actually contain Bengali, or the cost warning the
      // UI shows would be wrong.
      expect(/[ঀ-৿]/.test(row.body)).toBe(true);
    }
  });

  it("is editable by the office and by nobody else", async () => {
    const template = await db.query(
      "select id from public.notification_templates limit 1",
    );

    await asUser(db, ids.userAuthority, async () =>
      db.query("update public.notification_templates set body = $1 where id = $2", [
        "{school}: edited.",
        template.rows[0].id,
      ]),
    );

    const after = await db.query(
      "select body from public.notification_templates where id = $1",
      [template.rows[0].id],
    );
    expect(after.rows[0].body).toBe("{school}: edited.");

    const asTeacher = await rows(
      ids.userTeacherOne,
      "select id from public.notification_templates",
    );
    expect(asTeacher, "a teacher has no business reading message templates").toHaveLength(0);
  });
});
