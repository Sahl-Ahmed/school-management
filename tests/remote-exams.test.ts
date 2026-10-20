/**
 * Phase 5 verification against the REAL hosted Supabase project.
 *
 * tests/exams.test.mjs proves the SQL is correct against a local Postgres.
 * This suite proves the same workflow works through genuine sign-in, real
 * JWTs, PostgREST and the live schema — which is where the three security
 * defects of earlier phases were found and where none of them showed locally.
 *
 * It SKIPS ENTIRELY unless .env.local carries real credentials, so `npm test`
 * stays runnable on a machine with no Supabase project.
 *
 * What it writes to the project:
 *   * Auth users for three seeded demo people plus one non-admin office
 *     account, with random passwords generated in memory, never printed.
 *   * One exam for the seeded Second Term, two exam subjects for Class 3,
 *     marks for the three seeded Class 3 students, and the published results.
 * All of it is synthetic: the seed contains no real person. Accounts are
 * removable with `npm run test:remote:cleanup`; the exam rows are removed in
 * afterAll.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remoteCredentialStatus } from "./load-env.mjs";
import {
  syntheticStudentEmail,
  syntheticTeacherEmail,
} from "@/lib/auth/email-convention";

const status = remoteCredentialStatus();

/** Fixed ids from supabase/seed.sql. */
const SEED = {
  year: "a0000000-0000-4000-8000-000000000001",
  secondTerm: "17000000-0000-4000-8000-000000000002",
  class3: "c1000000-0000-4000-8000-000000000005",
  class3SectionA: "5ec00000-0000-4000-8000-000000000005",
  class8: "c1000000-0000-4000-8000-00000000000a",
  class8SectionA: "5ec00000-0000-4000-8000-000000000010",
  bangla: "50b00000-0000-4000-8000-000000000001",
  maths: "50b00000-0000-4000-8000-000000000003",
  english: "50b00000-0000-4000-8000-000000000002",
  teacherBangla: "7eac0000-0000-4000-8000-000000000001",
  teacherMaths: "7eac0000-0000-4000-8000-000000000002",
  teacherEnglish: "7eac0000-0000-4000-8000-000000000003",
  studentAlpha: "57000000-0000-4000-8000-000000000001",
  studentBeta: "57000000-0000-4000-8000-000000000002",
  studentEpsilon: "57000000-0000-4000-8000-000000000005",
  siblingElder: "57000000-0000-4000-8000-000000000003",
  scale: "9ab00000-0000-4000-8000-000000000001",
} as const;

const TEST_TAG = "phase5-exams";
const EXAM_NAME = `Phase 5 Verification Exam ${randomBytes(4).toString("hex")}`;

type Provisioned = { userId: string; email: string; password: string };

function strongPassword(): string {
  // Generated per run, held in memory only, never printed.
  return `Vf-${randomBytes(18).toString("base64url")}`;
}

let admin: SupabaseClient;
let url: string;
let anonKey: string;

/*
 * Keyed by a union rather than by `string`: under noUncheckedIndexedAccess a
 * string index would make every lookup possibly undefined, and a non-null
 * assertion at each of the ~40 call sites would hide a genuine typo.
 */
type Who =
  | "admin"
  | "staff"
  | "banglaTeacher"
  | "mathsTeacher"
  | "englishTeacher"
  | "alpha"
  | "beta";

const accounts = {} as Record<Who, Provisioned>;
const clients = {} as Record<Who, SupabaseClient>;

let examId = "";
let banglaSubjectId = "";
let mathsSubjectId = "";

function anonClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function provision(
  email: string,
  role: "authority_admin" | "authority_staff" | "teacher" | "student",
  fullName: string,
  link?: { table: "students" | "teachers"; id: string },
): Promise<Provisioned> {
  const password = strongPassword();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { created_by: TEST_TAG },
  });

  let userId: string;
  if (error) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email === email);
    if (!existing) throw new Error(`could not create or find ${email}: ${error.message}`);
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  } else {
    userId = data.user!.id;
  }

  await admin.from("profiles").upsert({
    id: userId,
    role,
    full_name: fullName,
    must_set_password: false,
    activated_at: new Date().toISOString(),
    is_active: true,
  });

  if (link) {
    await admin.from(link.table).update({ auth_user_id: userId }).eq("id", link.id);
  }

  return { userId, email, password };
}

async function signedInAs(who: Provisioned): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: who.email,
    password: who.password,
  });
  if (error) throw new Error(`sign-in failed for ${who.email}: ${error.message}`);
  return client;
}

describe.skipIf(!status.ready)("hosted project: phase 5 exams", () => {
  beforeAll(async () => {
    url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    accounts.admin = await provision(
      `authority.${TEST_TAG}@school.invalid`,
      "authority_admin",
      "Phase 5 Authority Admin",
    );
    // An office account that is authority but NOT an administrator, to prove
    // publishing is restricted to an administrator.
    accounts.staff = await provision(
      `staff.${TEST_TAG}@school.invalid`,
      "authority_staff",
      "Phase 5 Office Staff",
    );
    accounts.banglaTeacher = await provision(
      syntheticTeacherEmail(SEED.teacherBangla),
      "teacher",
      "Demo Teacher One",
      { table: "teachers", id: SEED.teacherBangla },
    );
    accounts.mathsTeacher = await provision(
      syntheticTeacherEmail(SEED.teacherMaths),
      "teacher",
      "Demo Teacher Two",
      { table: "teachers", id: SEED.teacherMaths },
    );
    accounts.englishTeacher = await provision(
      syntheticTeacherEmail(SEED.teacherEnglish),
      "teacher",
      "Demo Teacher Three",
      { table: "teachers", id: SEED.teacherEnglish },
    );
    accounts.alpha = await provision(
      syntheticStudentEmail(SEED.studentAlpha),
      "student",
      "Demo Student Alpha",
      { table: "students", id: SEED.studentAlpha },
    );
    accounts.beta = await provision(
      syntheticStudentEmail(SEED.studentBeta),
      "student",
      "Demo Student Beta",
      { table: "students", id: SEED.studentBeta },
    );

    for (const name of Object.keys(accounts) as Who[]) {
      clients[name] = await signedInAs(accounts[name]);
    }

    // The scale this project actually carries, so the assertions below check
    // the configured policy rather than a policy this file invented.
    const { data: scale } = await admin
      .from("grading_scales")
      .select("pass_rule, subject_pass_pct, fail_zeroes_gpa")
      .eq("id", SEED.scale)
      .single();

    expect(scale?.pass_rule, "the confirmed pass rule is in the project").toBe(
      "all_subjects",
    );
    expect(Number(scale?.subject_pass_pct)).toBe(33);
    expect(scale?.fail_zeroes_gpa).toBe(true);
  }, 120_000);

  afterAll(async () => {
    // Remove only this run's exam. The cascade takes its subjects, marks,
    // submissions and published results with it; the seed is untouched.
    if (examId) await admin.from("exams").delete().eq("id", examId);
    for (const client of Object.values(clients)) await client.auth.signOut();
  }, 60_000);

  // -------------------------------------------------------------------------
  it("a teacher cannot create an exam, the office can", async () => {
    const asTeacher = await clients.banglaTeacher
      .from("exams")
      .insert({
        academic_year_id: SEED.year,
        term_id: SEED.secondTerm,
        name: `${EXAM_NAME} (teacher attempt)`,
        status: "draft",
      })
      .select("id");

    expect(asTeacher.error, "a teacher creating an exam must be refused").not.toBeNull();

    const created = await clients.admin
      .from("exams")
      .insert({
        academic_year_id: SEED.year,
        term_id: SEED.secondTerm,
        name: EXAM_NAME,
        status: "draft",
        starts_on: "2026-07-01",
        ends_on: "2026-07-10",
        grading_scale_id: SEED.scale,
      })
      .select("id")
      .single();

    expect(created.error).toBeNull();
    examId = created.data!.id;
  });

  it("the office configures two subjects for Class 3", async () => {
    const bangla = await clients.admin
      .from("exam_subjects")
      .insert({
        exam_id: examId,
        class_id: SEED.class3,
        subject_id: SEED.bangla,
        max_marks: 100,
        pass_marks: 33,
        exam_date: "2026-07-01",
      })
      .select("id")
      .single();
    expect(bangla.error).toBeNull();
    banglaSubjectId = bangla.data!.id;

    const maths = await clients.admin
      .from("exam_subjects")
      .insert({
        exam_id: examId,
        class_id: SEED.class3,
        subject_id: SEED.maths,
        max_marks: 100,
        pass_marks: 33,
        exam_date: "2026-07-03",
      })
      .select("id")
      .single();
    expect(maths.error).toBeNull();
    mathsSubjectId = maths.data!.id;

    // The same subject twice for one class is refused by the unique key.
    const duplicate = await clients.admin.from("exam_subjects").insert({
      exam_id: examId,
      class_id: SEED.class3,
      subject_id: SEED.bangla,
      max_marks: 50,
    });
    expect(duplicate.error, "a duplicate class-subject must be refused").not.toBeNull();
  });

  // -------------------------------------------------------------------------
  it("marks cannot be entered while the exam is a draft", async () => {
    const { error } = await clients.banglaTeacher.rpc("submit_marks", {
      p_exam_subject_id: banglaSubjectId,
      p_section_id: SEED.class3SectionA,
      p_entries: [{ student_id: SEED.studentAlpha, marks: 80, absent: false }],
      p_reason: null,
    });

    expect(error, "entry before marks_open must be refused").not.toBeNull();
    expect(error!.message).toContain("mark entry is not open");
  });

  it("a student cannot see a draft exam at all", async () => {
    const { data } = await clients.alpha.from("exams").select("id").eq("id", examId);
    // The routine is unpublished, so the student policy excludes the row.
    expect(data ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  it("the office opens mark entry", async () => {
    const { error } = await clients.admin
      .from("exams")
      .update({ status: "marks_open" })
      .eq("id", examId);

    expect(error).toBeNull();
  });

  it("the assigned teacher submits marks; another teacher's subject is refused", async () => {
    const submitted = await clients.banglaTeacher.rpc("submit_marks", {
      p_exam_subject_id: banglaSubjectId,
      p_section_id: SEED.class3SectionA,
      p_entries: [
        { student_id: SEED.studentAlpha, marks: 80, absent: false },
        { student_id: SEED.studentBeta, marks: 65, absent: false },
        { student_id: SEED.studentEpsilon, marks: 30, absent: false },
      ],
      p_reason: null,
    });

    expect(submitted.error).toBeNull();
    expect((submitted.data as { marked: number }).marked).toBe(3);

    // Maths belongs to Teacher Two. The Bangla teacher is refused.
    const wrongSubject = await clients.banglaTeacher.rpc("submit_marks", {
      p_exam_subject_id: mathsSubjectId,
      p_section_id: SEED.class3SectionA,
      p_entries: [{ student_id: SEED.studentAlpha, marks: 99, absent: false }],
      p_reason: null,
    });

    expect(wrongSubject.error, "a teacher must not mark a subject they do not teach")
      .not.toBeNull();
    expect(wrongSubject.error!.message).toContain("not assigned to teach");
  });

  it("a teacher cannot mark a student outside the section", async () => {
    const { error } = await clients.banglaTeacher.rpc("submit_marks", {
      p_exam_subject_id: banglaSubjectId,
      p_section_id: SEED.class3SectionA,
      // The elder sibling is in Class 8, not Class 3 section A.
      p_entries: [{ student_id: SEED.siblingElder, marks: 70, absent: false }],
      p_reason: "validation check",
    });

    expect(error, "a student outside the section must be refused").not.toBeNull();
    expect(error!.message).toContain("not enrolled in this section");
  });

  it("a mark above the maximum is refused", async () => {
    const { error } = await clients.banglaTeacher.rpc("submit_marks", {
      p_exam_subject_id: banglaSubjectId,
      p_section_id: SEED.class3SectionA,
      p_entries: [{ student_id: SEED.studentAlpha, marks: 101, absent: false }],
      p_reason: "validation check",
    });

    expect(error, "a mark above max_marks must be refused").not.toBeNull();
    expect(error!.message).toMatch(/exceeds max_marks/);
  });

  it("changing submitted marks without a reason is refused", async () => {
    const { error } = await clients.banglaTeacher.rpc("submit_marks", {
      p_exam_subject_id: banglaSubjectId,
      p_section_id: SEED.class3SectionA,
      p_entries: [{ student_id: SEED.studentAlpha, marks: 81, absent: false }],
      p_reason: null,
    });

    expect(error, "a correction must require a reason").not.toBeNull();
    expect(error!.message).toContain("requires a reason");
  });

  // -------------------------------------------------------------------------
  it("draft marks are invisible to students and to unrelated teachers", async () => {
    const asStudent = await clients.alpha
      .from("marks")
      .select("id, marks_obtained")
      .eq("exam_subject_id", banglaSubjectId);

    expect(
      asStudent.data ?? [],
      "a student must not read draft marks, not even their own",
    ).toHaveLength(0);

    // The English teacher teaches Class 8, not this Class 3 subject.
    const asOtherTeacher = await clients.englishTeacher
      .from("marks")
      .select("id")
      .eq("exam_subject_id", banglaSubjectId);

    expect(asOtherTeacher.data ?? []).toHaveLength(0);

    // The assigned teacher does see their own subject's marks.
    const asOwnTeacher = await clients.banglaTeacher
      .from("marks")
      .select("id, marks_obtained")
      .eq("exam_subject_id", banglaSubjectId);

    expect(asOwnTeacher.data ?? []).toHaveLength(3);
  });

  it("submission progress is for the office only", async () => {
    const asAdmin = await clients.admin.rpc("exam_submission_progress", {
      p_exam_id: examId,
    });

    expect(asAdmin.error).toBeNull();
    const rows = asAdmin.data as {
      subject_name: string;
      roster: number;
      marks_entered: number;
      submitted_at: string | null;
      teacher_name: string | null;
    }[];

    expect(rows).toHaveLength(2);

    const bangla = rows.find((r) => r.subject_name === "Bangla")!;
    expect(Number(bangla.roster)).toBe(3);
    expect(Number(bangla.marks_entered)).toBe(3);
    expect(bangla.submitted_at).not.toBeNull();
    expect(bangla.teacher_name).toBe("Demo Teacher One");

    const maths = rows.find((r) => r.subject_name === "Mathematics")!;
    expect(Number(maths.marks_entered)).toBe(0);
    expect(maths.submitted_at, "Maths is not submitted yet").toBeNull();

    // The function guards on app.is_authority() internally, so a teacher gets
    // an empty set rather than another class's progress.
    const asTeacher = await clients.banglaTeacher.rpc("exam_submission_progress", {
      p_exam_id: examId,
    });
    expect(asTeacher.data ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  it("publishing is refused while any mark is un-entered", async () => {
    const { error } = await clients.admin.rpc("publish_results", { p_exam_id: examId });

    expect(error, "a partial exam must not publish").not.toBeNull();
    expect(error!.message).toMatch(/un-entered/);
  });

  it("the Maths teacher submits, including one absence", async () => {
    const { data, error } = await clients.mathsTeacher.rpc("submit_marks", {
      p_exam_subject_id: mathsSubjectId,
      p_section_id: SEED.class3SectionA,
      p_entries: [
        // Below the pass mark: the all_subjects rule must fail Alpha overall
        // even though the average passes.
        { student_id: SEED.studentAlpha, marks: 28, absent: false },
        { student_id: SEED.studentBeta, marks: 75, absent: false },
        // An absence is an explicit decision, not a missing mark.
        { student_id: SEED.studentEpsilon, marks: null, absent: true },
      ],
      p_reason: null,
    });

    expect(error).toBeNull();
    expect((data as { marked: number }).marked).toBe(3);
  });

  it("an office account that is not an administrator cannot publish", async () => {
    const { error } = await clients.staff.rpc("publish_results", { p_exam_id: examId });

    expect(error, "publishing must be administrator-only").not.toBeNull();
    expect(error!.message).toContain("only a school administrator");
  });

  it("a teacher cannot publish", async () => {
    const { error } = await clients.banglaTeacher.rpc("publish_results", {
      p_exam_id: examId,
    });
    expect(error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  it("the administrator publishes, and the figures follow the configured policy", async () => {
    const { data, error } = await clients.admin.rpc("publish_results", {
      p_exam_id: examId,
    });

    expect(error).toBeNull();
    const result = data as { published: number; scale: string; pass_rule: string };
    expect(result.published).toBe(3);
    expect(result.pass_rule).toBe("all_subjects");

    const { data: rows } = await admin
      .from("published_results")
      .select("student_id, total_obtained, total_max, percentage, gpa, grade, is_pass, snapshot, position_in_class")
      .eq("exam_id", examId);

    const byStudent = new Map(
      (rows ?? []).map((r) => [r.student_id as string, r]),
    );

    // Alpha: Bangla 80 (A+, 5.0), Maths 28 (F, below the 33 pass mark).
    // 108/200 = 54% overall — a passing average — but the school's rule is that
    // every subject must be passed, so Alpha does not pass and GPA prints 0.00.
    const alpha = byStudent.get(SEED.studentAlpha)!;
    expect(Number(alpha.total_obtained)).toBe(108);
    expect(Number(alpha.total_max)).toBe(200);
    expect(Number(alpha.percentage)).toBe(54);
    expect(alpha.is_pass).toBe(false);
    expect(Number(alpha.gpa)).toBe(0);
    expect(
      Number((alpha.snapshot as { gpa_computed: number }).gpa_computed),
      "the averaged figure is kept even though 0.00 is printed",
    ).toBe(2.5);

    // Migration 0032: the printed overall grade follows the result, so the
    // sheet cannot read "Not passed" beside a passing grade. The band grade
    // for 54% is kept in the snapshot.
    expect(alpha.grade, "a failed result prints the failing grade").toBe("F");
    expect((alpha.snapshot as { grade_computed: string }).grade_computed).toBe("B");
    expect((alpha.snapshot as { failed_subjects: number }).failed_subjects).toBe(1);

    const alphaSubjects = (alpha.snapshot as {
      subjects: { subject: string; grade: string; passed: boolean }[];
    }).subjects;
    expect(alphaSubjects.find((s) => s.subject === "Bangla")!.grade).toBe("A+");
    expect(alphaSubjects.find((s) => s.subject === "Bangla")!.passed).toBe(true);
    expect(alphaSubjects.find((s) => s.subject === "Mathematics")!.grade).toBe("F");
    expect(alphaSubjects.find((s) => s.subject === "Mathematics")!.passed).toBe(false);

    // Beta: Bangla 65 (A-, 3.5), Maths 75 (A, 4.0). 140/200 = 70%, both passed.
    const beta = byStudent.get(SEED.studentBeta)!;
    expect(Number(beta.percentage)).toBe(70);
    expect(beta.is_pass).toBe(true);
    expect(Number(beta.gpa)).toBe(3.75);
    // Beta passed, so printed and computed agree.
    expect(beta.grade).toBe("A");
    expect((beta.snapshot as { grade_computed: string }).grade_computed).toBe("A");
    expect(Number(beta.position_in_class), "Beta is top of the section").toBe(1);

    // Epsilon: Bangla 30 (F), Maths absent (scores zero, grade "Abs").
    const epsilon = byStudent.get(SEED.studentEpsilon)!;
    expect(Number(epsilon.total_obtained)).toBe(30);
    expect(epsilon.is_pass).toBe(false);
    const epsilonMaths = (epsilon.snapshot as {
      subjects: { subject: string; grade: string; absent: boolean; obtained: number | null }[];
    }).subjects.find((s) => s.subject === "Mathematics")!;
    expect(epsilonMaths.absent).toBe(true);
    expect(epsilonMaths.obtained, "an absence prints as absent, not as 0").toBeNull();

    // Attendance comes from the TERM's window and from submitted lessons only.
    const attendance = (beta.snapshot as {
      attendance: { window_start: string | null; submitted_lessons: number };
    }).attendance;
    expect(attendance.window_start).toBe("2026-05-01");
    expect(Number(attendance.submitted_lessons)).toBeGreaterThanOrEqual(0);
  });

  it("publishing twice is refused", async () => {
    const { error } = await clients.admin.rpc("publish_results", { p_exam_id: examId });

    expect(error, "a second publication must be refused").not.toBeNull();
    expect(error!.message).toMatch(/already published/);
  });

  it("the exam is now published and its status says so", async () => {
    const { data } = await admin
      .from("exams")
      .select("status, results_published_at")
      .eq("id", examId)
      .single();

    expect(data!.status).toBe("published");
    expect(data!.results_published_at).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  it("a student reads their own published result and nobody else's", async () => {
    const own = await clients.alpha.rpc("student_results", {
      p_student_id: SEED.studentAlpha,
    });

    expect(own.error).toBeNull();
    const rows = own.data as { exam_name: string; gpa: string | null; is_pass: boolean }[];
    const mine = rows.find((r) => r.exam_name === EXAM_NAME)!;
    expect(mine).toBeDefined();
    expect(mine.is_pass).toBe(false);

    // Asking for a classmate's result returns nothing: the function's own
    // visibility guard fails closed rather than trusting the argument.
    const other = await clients.alpha.rpc("student_results", {
      p_student_id: SEED.studentBeta,
    });
    expect(other.data ?? [], "a student must not read a classmate's result").toHaveLength(0);

    // The same through the table, which is what the page reads.
    const viaTable = await clients.alpha
      .from("published_results")
      .select("student_id")
      .eq("exam_id", examId);
    expect(viaTable.data ?? []).toHaveLength(1);
    expect(viaTable.data![0]!.student_id).toBe(SEED.studentAlpha);
  });

  it("a teacher sees results only for students they teach", async () => {
    const taught = await clients.banglaTeacher
      .from("published_results")
      .select("student_id")
      .eq("exam_id", examId);

    // Teacher One teaches Class 3 section A — all three of these students.
    expect(taught.data ?? []).toHaveLength(3);

    // Teacher Three teaches Class 8 only.
    const untaught = await clients.englishTeacher
      .from("published_results")
      .select("student_id")
      .eq("exam_id", examId);

    expect(untaught.data ?? [], "a teacher must not read an untaught class's results")
      .toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  it("a correction after publication does not rewrite the published sheet", async () => {
    const before = await admin
      .from("published_results")
      .select("total_obtained, snapshot")
      .eq("exam_id", examId)
      .eq("student_id", SEED.studentAlpha)
      .single();

    // The office corrects Alpha's Maths mark after publication.
    const { error } = await clients.admin.rpc("submit_marks", {
      p_exam_subject_id: mathsSubjectId,
      p_section_id: SEED.class3SectionA,
      p_entries: [
        { student_id: SEED.studentAlpha, marks: 90, absent: false },
        { student_id: SEED.studentBeta, marks: 75, absent: false },
        { student_id: SEED.studentEpsilon, marks: null, absent: true },
      ],
      p_reason: "re-marked after an addition error",
    });
    expect(error).toBeNull();

    const after = await admin
      .from("published_results")
      .select("total_obtained, snapshot")
      .eq("exam_id", examId)
      .eq("student_id", SEED.studentAlpha)
      .single();

    expect(
      Number(after.data!.total_obtained),
      "the published sheet a parent already received must not change",
    ).toBe(Number(before.data!.total_obtained));
    expect(after.data!.snapshot).toEqual(before.data!.snapshot);

    // The corrected mark is in the marks table, so the record is right even
    // though the sheet is frozen.
    const { data: mark } = await admin
      .from("marks")
      .select("marks_obtained")
      .eq("exam_subject_id", mathsSubjectId)
      .eq("student_id", SEED.studentAlpha)
      .single();
    expect(Number(mark!.marks_obtained)).toBe(90);
  });

  // -------------------------------------------------------------------------
  it("an anonymous caller can reach none of it", async () => {
    const anon = anonClient();

    const exams = await anon.from("exams").select("id").eq("id", examId);
    expect(exams.data ?? []).toHaveLength(0);

    const results = await anon.from("published_results").select("id").eq("exam_id", examId);
    expect(results.data ?? []).toHaveLength(0);

    const rpc = await anon.rpc("student_results", { p_student_id: SEED.studentAlpha });
    expect(rpc.error, "anon must not execute student_results").not.toBeNull();

    // Migration 0031: app.grade_for kept Supabase's default anon EXECUTE grant
    // until it was revoked by name. This is the regression guard.
    const grade = await anon.rpc("grade_for", { p_scale_id: SEED.scale, p_pct: 85 });
    expect(grade.error, "anon must not execute app.grade_for").not.toBeNull();
  });

  // -------------------------------------------------------------------------
  it("a class test is one teacher's own, and its result sends once", async () => {
    const created = await clients.banglaTeacher
      .from("class_tests")
      .insert({
        academic_year_id: SEED.year,
        class_id: SEED.class3,
        section_id: SEED.class3SectionA,
        subject_id: SEED.bangla,
        teacher_id: SEED.teacherBangla,
        name: `Phase 5 class test ${randomBytes(3).toString("hex")}`,
        max_marks: 20,
        test_date: "2026-07-05",
        status: "draft",
      })
      .select("id")
      .single();

    expect(created.error).toBeNull();
    const testId = created.data!.id;

    try {
      // Another teacher cannot see it.
      const other = await clients.englishTeacher
        .from("class_tests")
        .select("id")
        .eq("id", testId);
      expect(other.data ?? []).toHaveLength(0);

      // Sending before any mark exists is refused.
      const early = await clients.banglaTeacher.rpc("send_class_test_result", {
        p_class_test_id: testId,
      });
      expect(early.error).not.toBeNull();
      expect(early.error!.message).toContain("enter marks before");

      const marked = await clients.banglaTeacher.from("class_test_marks").insert([
        { class_test_id: testId, student_id: SEED.studentAlpha, marks_obtained: 18 },
        { class_test_id: testId, student_id: SEED.studentBeta, marks_obtained: 15 },
      ]);
      expect(marked.error).toBeNull();

      const sent = await clients.banglaTeacher.rpc("send_class_test_result", {
        p_class_test_id: testId,
      });
      expect(sent.error).toBeNull();
      expect((sent.data as { students: number }).students).toBe(2);

      // The duplicate guard: a second send is refused, so a double click
      // cannot produce two rounds of SMS.
      const again = await clients.banglaTeacher.rpc("send_class_test_result", {
        p_class_test_id: testId,
      });
      expect(again.error, "a second send must be refused").not.toBeNull();
      expect(again.error!.message).toMatch(/already sent/);

      // Only now can the student see it.
      const asStudent = await clients.alpha
        .from("class_test_marks")
        .select("marks_obtained")
        .eq("class_test_id", testId);
      expect(asStudent.data ?? []).toHaveLength(1);
      expect(Number(asStudent.data![0]!.marks_obtained)).toBe(18);
    } finally {
      await admin.from("class_tests").delete().eq("id", testId);
    }
  });
});
