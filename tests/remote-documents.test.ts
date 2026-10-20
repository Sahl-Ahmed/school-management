/**
 * Phase 6 verification against the REAL hosted Supabase project.
 *
 * tests/documents.test.mjs proves the SQL is right against a local Postgres.
 * This proves the same through genuine sign-in, real JWTs, PostgREST and the
 * live schema — where every security defect of the earlier phases was found
 * and none of them showed locally.
 *
 * The three things worth travelling to the real project for:
 *   * a TEACHER getting nothing from the feedback tables through PostgREST,
 *     which applies its own RLS pass that a local test cannot stand in for;
 *   * an ANONYMOUS caller reaching the public card and nothing else;
 *   * the office being unable to issue a blocked admit card, which is the
 *     brief's explicit requirement.
 *
 * It SKIPS ENTIRELY unless .env.local carries real credentials.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remoteCredentialStatus } from "./load-env.mjs";
import {
  syntheticStudentEmail,
  syntheticTeacherEmail,
} from "@/lib/auth/email-convention";
import { PDFDocument } from "pdf-lib";
import { buildAdmitCardPdf } from "@/lib/pdf/admit-card";
import { buildExamRoutinePdf } from "@/lib/pdf/exam-routine";
import { buildIdCardPdf } from "@/lib/pdf/id-card";
import { A4, mm } from "@/lib/pdf/base";

const status = remoteCredentialStatus();

/** Fixed ids from supabase/seed.sql. */
const SEED = {
  year: "a0000000-0000-4000-8000-000000000001",
  secondTerm: "17000000-0000-4000-8000-000000000002",
  class3: "c1000000-0000-4000-8000-000000000005",
  class3SectionA: "5ec00000-0000-4000-8000-000000000005",
  bangla: "50b00000-0000-4000-8000-000000000001",
  maths: "50b00000-0000-4000-8000-000000000003",
  teacherBangla: "7eac0000-0000-4000-8000-000000000001",
  teacherEnglish: "7eac0000-0000-4000-8000-000000000003",
  studentAlpha: "57000000-0000-4000-8000-000000000001",
  studentBeta: "57000000-0000-4000-8000-000000000002",
  idTemplatePortrait: "d0c00000-0000-4000-8000-000000000001",
} as const;

/** Monthly tuition, from supabase/seed.sql. */
const FEE_TYPE_TUITION = "fee00000-0000-4000-8000-000000000001";

const TEST_TAG = "phase6-documents";
const SUFFIX = randomBytes(4).toString("hex");
const EXAM_NAME = `Phase 6 Verification Exam ${SUFFIX}`;
const CAMPAIGN_NAME = `Phase 6 Verification Feedback ${SUFFIX}`;

type Provisioned = { userId: string; email: string; password: string };
type Who = "admin" | "staff" | "banglaTeacher" | "englishTeacher" | "alpha" | "beta";

function strongPassword(): string {
  // Generated per run, held in memory only, never printed.
  return `Vf-${randomBytes(18).toString("base64url")}`;
}

let admin: SupabaseClient;
let url: string;
let anonKey: string;

const accounts = {} as Record<Who, Provisioned>;
const clients = {} as Record<Who, SupabaseClient>;

let examId = "";
let campaignId = "";
let questionIds: string[] = [];
const createdTokens: string[] = [];
/**
 * The qr_token ids this run issued.
 *
 * Used to find its own issue-log rows again. Deliberately NOT a timestamp: the
 * local clock in this environment has run ahead of the database's by tens of
 * seconds, so a `generated_at >= <client now>` filter silently matched nothing
 * and left rows behind — the same skew that bit the phase 4 audit checks.
 */
const createdTokenIds: string[] = [];

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
    email, password, email_confirm: true,
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
    id: userId, role, full_name: fullName,
    must_set_password: false, activated_at: new Date().toISOString(), is_active: true,
  });

  if (link) {
    await admin.from(link.table).update({ auth_user_id: userId }).eq("id", link.id);
  }

  return { userId, email, password };
}

async function signedInAs(who: Provisioned): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: who.email, password: who.password,
  });
  if (error) throw new Error(`sign-in failed for ${who.email}: ${error.message}`);
  return client;
}

describe.skipIf(!status.ready)("hosted project: phase 6 documents", () => {
  beforeAll(async () => {
    url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    accounts.admin = await provision(
      `authority.${TEST_TAG}@school.invalid`, "authority_admin", "Phase 6 Authority",
    );
    accounts.staff = await provision(
      `staff.${TEST_TAG}@school.invalid`, "authority_staff", "Phase 6 Office Staff",
    );
    accounts.banglaTeacher = await provision(
      syntheticTeacherEmail(SEED.teacherBangla), "teacher", "Demo Teacher One",
      { table: "teachers", id: SEED.teacherBangla },
    );
    accounts.englishTeacher = await provision(
      syntheticTeacherEmail(SEED.teacherEnglish), "teacher", "Demo Teacher Three",
      { table: "teachers", id: SEED.teacherEnglish },
    );
    accounts.alpha = await provision(
      syntheticStudentEmail(SEED.studentAlpha), "student", "Demo Student Alpha",
      { table: "students", id: SEED.studentAlpha },
    );
    accounts.beta = await provision(
      syntheticStudentEmail(SEED.studentBeta), "student", "Demo Student Beta",
      { table: "students", id: SEED.studentBeta },
    );

    for (const name of Object.keys(accounts) as Who[]) {
      clients[name] = await signedInAs(accounts[name]);
    }

    // An exam, so admit cards have something to belong to.
    const exam = await admin
      .from("exams")
      .insert({
        academic_year_id: SEED.year,
        term_id: SEED.secondTerm,
        name: EXAM_NAME,
        status: "scheduled",
        starts_on: "2026-06-01",
        ends_on: "2026-06-10",
      })
      .select("id")
      .single();
    examId = exam.data!.id;

    await admin.from("exam_subjects").insert([
      { exam_id: examId, class_id: SEED.class3, subject_id: SEED.bangla, max_marks: 100, pass_marks: 33, exam_date: "2026-06-01" },
      { exam_id: examId, class_id: SEED.class3, subject_id: SEED.maths, max_marks: 100, pass_marks: 33, exam_date: "2026-06-03" },
    ]);

    // A feedback round with its questions.
    const campaign = await admin
      .from("feedback_campaigns")
      .insert({
        academic_year_id: SEED.year,
        term_id: SEED.secondTerm,
        name: CAMPAIGN_NAME,
        status: "draft",
        blocks_admit_card: true,
        min_periods_taught: 0,
      })
      .select("id")
      .single();
    campaignId = campaign.data!.id;

    const questions = await admin
      .from("feedback_questions")
      .insert([
        { campaign_id: campaignId, prompt: "Does this teacher explain clearly?", prompt_bn: "এই শিক্ষক কি স্পষ্টভাবে বোঝান?", order_no: 1, scale_min: 1, scale_max: 5 },
        { campaign_id: campaignId, prompt: "Can you ask questions comfortably?", prompt_bn: "আপনি কি সহজে প্রশ্ন করতে পারেন?", order_no: 2, scale_min: 1, scale_max: 5 },
      ])
      .select("id");
    questionIds = (questions.data ?? []).map((q) => q.id);
  }, 180_000);

  afterAll(async () => {
    // Remove only this run's rows. The cascades take targets, responses,
    // comments, completions, seat tokens and generated documents with them.
    for (const token of createdTokens) {
      await admin.from("qr_tokens").delete().eq("token", token);
    }

    /*
     * The ID-card issue log too. generated_documents has no FK to qr_tokens —
     * it is a record of what was produced, which is the point — and an id_card
     * row carries no exam_id, so nothing cascades it away. Without this, every
     * run of this suite leaves rows behind on the project.
     *
     * Matched on the token id recorded in meta, which is exact, rather than on
     * a time window, which the clock skew would break.
     */
    for (const tokenId of createdTokenIds) {
      await admin
        .from("generated_documents")
        .delete()
        .eq("kind", "id_card")
        .contains("meta", { qr_token_id: tokenId });
    }
    if (campaignId) await admin.from("feedback_campaigns").delete().eq("id", campaignId);
    if (examId) await admin.from("exams").delete().eq("id", examId);
    // The charge this suite raised to make the fee block deterministic.
    await admin
      .from("fee_charges")
      .delete()
      .eq("student_id", SEED.studentAlpha)
      .eq("fee_type_id", FEE_TYPE_TUITION)
      .eq("period_year", 2026)
      .eq("period_month", 6)
      .eq("amount", 500);
    for (const client of Object.values(clients)) await client.auth.signOut();
  }, 120_000);

  // -------------------------------------------------------------------------
  it("a teacher cannot create a feedback round or generate forms", async () => {
    const created = await clients.banglaTeacher.from("feedback_campaigns").insert({
      academic_year_id: SEED.year,
      term_id: SEED.secondTerm,
      name: `teacher attempt ${SUFFIX}`,
    });
    expect(created.error, "a teacher creating a round must be refused").not.toBeNull();

    const generated = await clients.banglaTeacher.rpc("generate_feedback_targets", {
      p_campaign_id: campaignId,
    });
    expect(generated.error).not.toBeNull();
  });

  it("the office generates forms from the term's assignments", async () => {
    const { data, error } = await clients.admin.rpc("generate_feedback_targets", {
      p_campaign_id: campaignId,
    });

    expect(error).toBeNull();
    const result = data as { forms: number; pairs_considered: number };
    expect(result.forms, "the seeded Class 3 assignments produce forms").toBeGreaterThan(0);
  });

  it("a student sees only their own forms", async () => {
    await admin.from("feedback_campaigns").update({ status: "open" }).eq("id", campaignId);

    const mine = await clients.alpha.rpc("student_feedback_forms", {
      p_campaign_id: campaignId,
    });
    expect(mine.error).toBeNull();
    expect((mine.data ?? []).length).toBeGreaterThan(0);

    // The table directly, which is what RLS guards.
    const all = await clients.alpha
      .from("feedback_targets")
      .select("student_id")
      .eq("campaign_id", campaignId);

    const others = (all.data ?? []).filter((r) => r.student_id !== SEED.studentAlpha);
    expect(others, "a student must not see another student's forms").toHaveLength(0);
  });

  it("submits feedback and records completion without the answers", async () => {
    const target = await clients.alpha
      .from("feedback_targets")
      .select("id")
      .eq("campaign_id", campaignId)
      .is("answered_at", null)
      .limit(1)
      .single();

    const { data, error } = await clients.alpha.rpc("submit_feedback", {
      p_campaign_id: campaignId,
      p_target_id: target.data!.id,
      p_ratings: questionIds.map((id) => ({ question_id: id, rating: 5 })),
      p_comment: "Explains the lesson very clearly. পড়ানো ভালো।",
    });

    expect(error).toBeNull();
    expect((data as { submitted: boolean }).submitted).toBe(true);

    // The same form again is refused: the completions row is what the
    // uniqueness sits on, and the rating itself cannot be found to change.
    const again = await clients.alpha.rpc("submit_feedback", {
      p_campaign_id: campaignId,
      p_target_id: target.data!.id,
      p_ratings: questionIds.map((id) => ({ question_id: id, rating: 1 })),
      p_comment: null,
    });
    expect(again.error, "a second submission of one form must be refused").not.toBeNull();
  });

  it("a TEACHER reads no rating, no comment and no aggregate", async () => {
    const responses = await clients.banglaTeacher
      .from("feedback_responses")
      .select("id, rating")
      .eq("campaign_id", campaignId);
    expect(responses.data ?? [], "a teacher must read no raw ratings").toHaveLength(0);

    const comments = await clients.banglaTeacher
      .from("feedback_comments")
      .select("id, body")
      .eq("campaign_id", campaignId);
    expect(comments.data ?? [], "a teacher must read no comments").toHaveLength(0);

    const analysis = await clients.banglaTeacher.rpc("feedback_analysis", {
      p_campaign_id: campaignId,
      p_min_responses: 3,
    });
    expect(
      analysis.data ?? [],
      "a teacher must not read even their own aggregate",
    ).toHaveLength(0);

    const completion = await clients.banglaTeacher.rpc("feedback_completion_overview", {
      p_campaign_id: campaignId,
      p_class_id: null,
    });
    expect(completion.data ?? []).toHaveLength(0);
  });

  it("a STUDENT reads no rating either, not even their own", async () => {
    const responses = await clients.alpha
      .from("feedback_responses")
      .select("id")
      .eq("campaign_id", campaignId);
    expect(responses.data ?? []).toHaveLength(0);

    const comments = await clients.alpha
      .from("feedback_comments")
      .select("id")
      .eq("campaign_id", campaignId);
    expect(comments.data ?? []).toHaveLength(0);
  });

  it("the office reads the aggregate, the comments and who has finished", async () => {
    const analysis = await clients.admin.rpc("feedback_analysis", {
      p_campaign_id: campaignId,
      p_min_responses: 3,
    });
    expect(analysis.error).toBeNull();

    const rows = analysis.data as { response_count: number; below_sample_floor: boolean }[];
    expect(rows.length).toBeGreaterThan(0);
    // One student has answered, so every row is flagged as a small sample.
    expect(rows.every((r) => r.below_sample_floor)).toBe(true);

    const comments = await clients.admin
      .from("feedback_comments")
      .select("body")
      .eq("campaign_id", campaignId);
    expect((comments.data ?? []).length).toBeGreaterThan(0);

    const overview = await clients.admin.rpc("feedback_completion_overview", {
      p_campaign_id: campaignId,
      p_class_id: null,
    });
    expect((overview.data ?? []).length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  it("blocks every admit card until a rule is configured", async () => {
    const { data } = await clients.admin.rpc("admit_card_eligibility", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
    });

    const elig = data as { eligible: boolean; blocks: string[] };
    expect(elig.eligible).toBe(false);
    expect(elig.blocks).toContain("no_rule_configured");
  });

  it("defaults the fee cutoff to the exam's own month, as the owner chose", async () => {
    const { data, error } = await clients.admin.rpc("default_admit_card_rule", {
      p_exam_id: examId,
    });

    expect(error).toBeNull();

    /*
     * The rule is pinned to THIS run's round and a charge is raised for the
     * exam's month, so the verdict below depends on what this suite created
     * rather than on whatever else the shared project happens to hold. Two
     * assertions here failed once for exactly that reason: a browser
     * walkthrough had settled the student's fees and completed a different
     * round in the same term.
     */
    await admin
      .from("admit_card_rules")
      .update({ feedback_campaign_id: campaignId })
      .eq("exam_id", examId);

    await admin.from("fee_charges").insert({
      student_id: SEED.studentAlpha,
      academic_year_id: SEED.year,
      fee_type_id: FEE_TYPE_TUITION,
      amount: 500,
      period_year: 2026,
      period_month: 6,
      status: "pending",
      due_on: "2026-06-10",
    });
    const rule = data as {
      fees_cleared_through_year: number;
      fees_cleared_through_month: number;
      require_feedback: boolean;
      allow_override: boolean;
    };

    // The exam starts 1 June 2026, so the cutoff is June — not May.
    expect(Number(rule.fees_cleared_through_year)).toBe(2026);
    expect(Number(rule.fees_cleared_through_month)).toBe(6);
    expect(rule.require_feedback).toBe(true);
    expect(rule.allow_override, "exceptions stay off until the owner says so").toBe(false);
  });

  it("refuses to issue a blocked card to the OFFICE as well as the student", async () => {
    const asOffice = await clients.admin.rpc("issue_admit_card", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
    });
    expect(
      asOffice.error,
      "the brief requires the office to be unable to issue a blocked card",
    ).not.toBeNull();
    expect(asOffice.error!.message).toMatch(/blocked/);

    const asStudent = await clients.alpha.rpc("issue_admit_card", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
    });
    expect(asStudent.error).not.toBeNull();
  });

  it("refuses an exception while overrides are switched off", async () => {
    const { error } = await clients.admin.rpc("override_admit_card", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
      p_reason: "verification check",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not permitted/);
  });

  it("office staff who are not administrators cannot approve an exception", async () => {
    await admin.from("admit_card_rules").update({ allow_override: true }).eq("exam_id", examId);

    const asStaff = await clients.staff.rpc("override_admit_card", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
      p_reason: "verification check",
    });
    expect(asStaff.error).not.toBeNull();
    expect(asStaff.error!.message).toMatch(/administrator/);

    // The administrator can, and it is recorded with the overridden checks.
    const asAdmin = await clients.admin.rpc("override_admit_card", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
      p_reason: "guardian in hospital — approved by the head teacher",
    });
    expect(asAdmin.error).toBeNull();

    const record = await admin
      .from("admit_card_overrides")
      .select("reason, overridden_checks")
      .eq("exam_id", examId)
      .eq("student_id", SEED.studentAlpha)
      .single();

    expect(record.data!.reason).toContain("hospital");
    expect(
      (record.data!.overridden_checks as string[]).length,
      "the checks that were overridden are captured, not just the fact of it",
    ).toBeGreaterThan(0);
  });

  it("an exception requires a reason", async () => {
    const { error } = await clients.admin.rpc("override_admit_card", {
      p_student_id: SEED.studentBeta,
      p_exam_id: examId,
      p_reason: "   ",
    });
    expect(error).not.toBeNull();
  });

  it("issues the card once the exception stands, with a stable seat code", async () => {
    // The override is what makes the student eligible here; the fee charge this
    // suite raised is left outstanding on purpose, so the verdict proves the
    // exception works rather than that the blocks happened to clear.

    const elig = await clients.admin.rpc("admit_card_eligibility", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
    });
    const verdict = elig.data as { eligible: boolean; overridden: boolean };
    expect(verdict.eligible).toBe(true);
    expect(verdict.overridden).toBe(true);

    const first = await clients.admin.rpc("issue_admit_card", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
    });
    expect(first.error).toBeNull();

    const seat = (first.data as { seat_token: string }).seat_token;
    expect(seat).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);

    // A reprint carries the same code as the card already in the student's hand.
    const second = await clients.admin.rpc("issue_admit_card", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
    });
    expect((second.data as { seat_token: string }).seat_token).toBe(seat);
  });

  it("a teacher cannot issue an admit card, and sees no admit overview", async () => {
    const issue = await clients.banglaTeacher.rpc("issue_admit_card", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
    });
    expect(issue.error).not.toBeNull();

    const overview = await clients.banglaTeacher.rpc("exam_admit_overview", {
      p_exam_id: examId,
      p_class_id: null,
    });
    expect(overview.data ?? []).toHaveLength(0);
  });

  it("a student reads their own admit card data and not a classmate's", async () => {
    const own = await clients.alpha.rpc("admit_card_data", {
      p_student_id: SEED.studentAlpha,
      p_exam_id: examId,
    });
    expect(own.error).toBeNull();

    const payload = own.data as {
      student: { registration_no: string };
      subjects: unknown[];
      seat_token: string;
      eligibility: { eligible: boolean };
    };
    expect(payload.student.registration_no).toBe("STU-2026-0001");
    expect(payload.subjects).toHaveLength(2);
    expect(payload.seat_token).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(payload.eligibility.eligible).toBe(true);

    const other = await clients.alpha.rpc("admit_card_data", {
      p_student_id: SEED.studentBeta,
      p_exam_id: examId,
    });
    expect(other.error, "a student must not read a classmate's admit card").not.toBeNull();
  });

  // -------------------------------------------------------------------------
  it("copies only the template's fields into the public card snapshot", async () => {
    const token = randomBytes(32).toString("base64url");
    createdTokens.push(token);

    const { data, error } = await clients.admin.rpc("issue_qr_token", {
      p_student_id: SEED.studentAlpha,
      p_token: token,
      p_template_id: SEED.idTemplatePortrait,
      p_replacing_reason: null,
    });

    expect(error).toBeNull();
    const result = data as { fields: string[]; qr_token_id: string };
    createdTokenIds.push(result.qr_token_id);

    // The owner's decision: the guardian's number is printed on the card.
    expect(result.fields).toContain("guardian_phone");
    expect(result.fields).toContain("full_name");
    expect(result.fields).toContain("blood_group");

    for (const forbidden of ["father_name", "mother_name", "fees", "marks", "gpa", "attendance"]) {
      expect(result.fields, `${forbidden} must never reach the public page`)
        .not.toContain(forbidden);
    }
  });

  it("refuses a snapshot carrying a forbidden key, whatever writes it", async () => {
    // The trigger, not the template, is the guarantee. Attempted with the
    // SERVICE ROLE, which bypasses RLS entirely — and is still refused.
    const { error } = await admin.from("qr_tokens").insert({
      token: randomBytes(32).toString("base64url"),
      student_id: SEED.studentBeta,
      card_snapshot: { full_name: "X", father_name: "Should be refused" },
    });

    expect(error, "the forbidden-key trigger must stop even the service role")
      .not.toBeNull();
    expect(error!.message).toMatch(/not public card data/);
  });

  it("the public page resolves for an anonymous visitor, and nothing else does", async () => {
    const token = createdTokens[createdTokens.length - 1]!;
    const anon = anonClient();

    const { data, error } = await anon.rpc("get_public_card", { p_token: token });
    expect(error).toBeNull();

    const card = data as {
      card: Record<string, unknown>;
      school: { name: string; office_phone: string };
    };
    expect(card.card.full_name).toBe("Demo Student Alpha");
    expect(card.school.office_phone).toBeTruthy();

    // Nothing beyond the snapshot, the school block and the issue date.
    expect(Object.keys(card).sort()).toEqual(["card", "issued_at", "school"]);

    const serialised = JSON.stringify(card).toLowerCase();
    for (const forbidden of ["father", "mother", "nid", "birth_certificate", "gpa", "attendance"]) {
      expect(serialised).not.toContain(forbidden);
    }

    // And the tables themselves stay shut.
    const tokens = await anon.from("qr_tokens").select("id");
    expect(tokens.data ?? []).toHaveLength(0);

    const seats = await anon.from("exam_seat_tokens").select("id");
    expect(seats.data ?? []).toHaveLength(0);

    const targets = await anon.from("feedback_targets").select("id");
    expect(targets.data ?? []).toHaveLength(0);

    const cardData = await anon.rpc("admit_card_data", {
      p_student_id: SEED.studentAlpha, p_exam_id: examId,
    });
    expect(cardData.error, "anon must not execute admit_card_data").not.toBeNull();
  });

  it("revokes the previous card when a replacement is issued", async () => {
    const replaced = createdTokens[createdTokens.length - 1]!;
    const replacement = randomBytes(32).toString("base64url");
    createdTokens.push(replacement);

    const { data, error } = await clients.admin.rpc("issue_qr_token", {
      p_student_id: SEED.studentAlpha,
      p_token: replacement,
      p_template_id: SEED.idTemplatePortrait,
      p_replacing_reason: "card lost",
    });

    expect(error, "reissuing must work — the old row is revoked before the insert")
      .toBeNull();

    const issued = data as { replaced_previous: boolean; qr_token_id: string };
    createdTokenIds.push(issued.qr_token_id);
    expect(issued.replaced_previous).toBe(true);

    const anon = anonClient();

    const dead = await anon.rpc("get_public_card", { p_token: replaced });
    expect(dead.data, "a revoked card must stop resolving").toBeNull();

    const live = await anon.rpc("get_public_card", { p_token: replacement });
    expect((live.data as { card: { full_name: string } }).card.full_name)
      .toBe("Demo Student Alpha");
  });

  it("a teacher cannot issue or revoke a card", async () => {
    const issue = await clients.banglaTeacher.rpc("issue_qr_token", {
      p_student_id: SEED.studentAlpha,
      p_token: randomBytes(32).toString("base64url"),
      p_template_id: SEED.idTemplatePortrait,
      p_replacing_reason: null,
    });
    expect(issue.error).not.toBeNull();

    const tokenRow = await admin
      .from("qr_tokens")
      .select("id")
      .eq("student_id", SEED.studentAlpha)
      .is("revoked_at", null)
      .single();

    const revoke = await clients.banglaTeacher.rpc("revoke_qr_token", {
      p_token_id: tokenRow.data!.id,
      p_reason: "teacher attempt",
    });
    expect(revoke.error).not.toBeNull();
  });

  it("a student reads their own card row and not a classmate's", async () => {
    const own = await clients.alpha.from("qr_tokens").select("student_id").is("revoked_at", null);
    const foreign = (own.data ?? []).filter((r) => r.student_id !== SEED.studentAlpha);
    expect(foreign).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  it("hides an unpublished exam routine from a student", async () => {
    const asStudent = await clients.alpha.rpc("exam_routine_data", { p_exam_id: examId });
    expect(asStudent.data, "unpublished means invisible, not merely unlinked").toBeNull();

    const asOffice = await clients.admin.rpc("exam_routine_data", { p_exam_id: examId });
    const payload = asOffice.data as { rows: unknown[] };
    expect(payload.rows).toHaveLength(2);
  });

  it("shows it once published", async () => {
    await admin
      .from("exams")
      .update({ routine_published_at: new Date().toISOString() })
      .eq("id", examId);

    const asStudent = await clients.alpha.rpc("exam_routine_data", { p_exam_id: examId });
    expect((asStudent.data as { rows: unknown[] }).rows).toHaveLength(2);
  });

  it("has no result sheet until results are published", async () => {
    const { data } = await clients.admin.rpc("result_sheet_data", {
      p_exam_id: examId, p_student_id: null, p_section_id: null,
    });
    expect(data, "an unpublished exam yields no sheet at all").toBeNull();
  });

  // -------------------------------------------------------------------------
  /*
   * The PDFs, built from the project's OWN rows rather than fixtures.
   *
   * tests/documents-pdf.test.ts measures geometry against hand-written input.
   * These run the same generators over what the hosted project actually
   * returns, which is the step that would catch a payload whose shape the
   * generator cannot read — a renamed key, a numeric arriving as a string —
   * and it is also where Bangla gets exercised end to end, because the seeded
   * subject names carry Bengali.
   */
  describe("PDFs built from the project's own data", () => {
    const BANGLA_NAME = "ঢাকা আদর্শ উচ্চ বিদ্যালয়";
    let originalName: string | null = null;

    beforeAll(async () => {
      // The school name heads every sheet, so this is the one field that puts
      // Bengali through the shared header path of all four generators.
      const current = await admin
        .from("school_settings").select("name").eq("id", true).single();
      originalName = current.data?.name ?? null;

      await admin.from("school_settings").update({ name: BANGLA_NAME }).eq("id", true);
    }, 60_000);

    afterAll(async () => {
      if (originalName !== null) {
        await admin.from("school_settings").update({ name: originalName }).eq("id", true);
      }
    }, 60_000);

    it("builds an A4 admit card from the real payload, with Bangla intact", async () => {
      const { data, error } = await clients.admin.rpc("admit_card_data", {
        p_student_id: SEED.studentAlpha,
        p_exam_id: examId,
      });
      expect(error).toBeNull();

      const payload = data as {
        school: { name: string; address: string | null; office_phone: string | null };
        student: Parameters<typeof buildAdmitCardPdf>[0]["cards"][number]["student"];
        exam: Parameters<typeof buildAdmitCardPdf>[0]["cards"][number]["exam"];
        seat_token: string | null;
        subjects: Parameters<typeof buildAdmitCardPdf>[0]["cards"][number]["subjects"];
      };

      expect(payload.school.name, "the Bangla school name reaches the generator")
        .toBe(BANGLA_NAME);

      const { bytes, dropped, pages } = await buildAdmitCardPdf({
        school: payload.school,
        generatedAt: "20 October 2026",
        cards: [{
          student: payload.student,
          exam: payload.exam,
          seat_token: payload.seat_token,
          subjects: payload.subjects,
        }],
      });

      expect(dropped, "Bengali in the school name and subjects must all have glyphs")
        .toBe(0);
      expect(pages).toBe(1);

      const doc = await PDFDocument.load(bytes);
      const { width, height } = doc.getPage(0).getSize();
      expect(Math.round(width)).toBe(Math.round(A4.width));
      expect(Math.round(height)).toBe(Math.round(A4.height));
    });

    it("builds an A4 exam routine from the real payload, with Bangla subjects", async () => {
      const { data } = await clients.admin.rpc("exam_routine_data", { p_exam_id: examId });

      const payload = data as Parameters<typeof buildExamRoutinePdf>[0] & {
        rows: { subject_bn: string | null }[];
      };

      // The seed records Bengali names for every subject, so this sheet has
      // real Bengali in its body as well as its header.
      expect(payload.rows.some((r) => r.subject_bn), "seeded subjects carry Bangla names")
        .toBe(true);

      const { bytes, dropped } = await buildExamRoutinePdf({
        school: payload.school,
        exam: payload.exam,
        rows: payload.rows as Parameters<typeof buildExamRoutinePdf>[0]["rows"],
        generatedAt: "20 October 2026",
      });

      expect(dropped).toBe(0);

      const { width, height } = (await PDFDocument.load(bytes)).getPage(0).getSize();
      expect(Math.round(width)).toBe(Math.round(A4.width));
      expect(Math.round(height)).toBe(Math.round(A4.height));
    });

    it("builds a PVC-sized ID card from the live card snapshot", async () => {
      const token = await admin
        .from("qr_tokens")
        .select("card_snapshot, document_templates(orientation, config)")
        .eq("student_id", SEED.studentAlpha)
        .is("revoked_at", null)
        .single();

      const template = (Array.isArray(token.data!.document_templates)
        ? token.data!.document_templates[0]
        : token.data!.document_templates) as {
          orientation: "portrait" | "landscape";
          config: { front_fields: string[]; back_fields: string[]; return_note: string };
        };

      const school = await admin
        .from("school_settings")
        .select("name, short_name, address, office_phone, email")
        .single();

      const { bytes, dropped } = await buildIdCardPdf(
        {
          school: school.data!,
          orientation: template.orientation,
          frontFields: template.config.front_fields,
          backFields: template.config.back_fields,
          returnNote: template.config.return_note,
          fields: token.data!.card_snapshot as Record<string, string | number | null>,
        },
        "both",
      );

      expect(dropped).toBe(0);

      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount(), "front and back").toBe(2);

      // CR80, measured in millimetres, because that is what a card printer and
      // a card holder are specified in.
      const { width, height } = doc.getPage(0).getSize();
      expect(width / mm(1)).toBeCloseTo(54, 1);
      expect(height / mm(1)).toBeCloseTo(85.6, 1);
    });
  });
});
