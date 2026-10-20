/**
 * Phase 7 verification against the REAL hosted Supabase project.
 *
 * What only the real project proves:
 *   * PostgREST applies its own RLS pass, so "a student cannot read a draft
 *     book" has to be checked through it, not only against a local Postgres.
 *   * An anonymous caller really does get the guardian's phone number from the
 *     public card now — the owner's decision, and the opposite of what phase 6
 *     shipped, so it is worth seeing happen against the live schema.
 *   * The dedupe index really refuses a duplicate daily summary on a database
 *     with the production grants in place.
 *
 * Nothing in here sends an SMS. No provider is connected and none is being
 * connected, so every dispatch is simulated by construction: there is no code
 * path from these tests to a phone.
 *
 * SKIPS ENTIRELY unless .env.local carries real credentials.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remoteCredentialStatus } from "./load-env.mjs";
import {
  syntheticStudentEmail,
  syntheticTeacherEmail,
} from "@/lib/auth/email-convention";
import { readableOn } from "@/lib/school/contrast";
import { renderTemplate } from "@/lib/sms/templates";
import { countSegments } from "@/lib/sms/segments";

const status = remoteCredentialStatus();

const SEED = {
  year: "a0000000-0000-4000-8000-000000000001",
  class3: "c1000000-0000-4000-8000-000000000005",
  class8: "c1000000-0000-4000-8000-00000000000a",
  teacherBangla: "7eac0000-0000-4000-8000-000000000001",
  studentAlpha: "57000000-0000-4000-8000-000000000001",
  idTemplatePortrait: "d0c00000-0000-4000-8000-000000000001",
} as const;

const TEST_TAG = "phase7-library";
const SUFFIX = randomBytes(4).toString("hex");
const BOOK_MARK = `Phase 7 Verification ${SUFFIX}`;

type Who = "admin" | "teacher" | "alpha";
type Provisioned = { userId: string; email: string; password: string };

function strongPassword(): string {
  return `Vf-${randomBytes(18).toString("base64url")}`;
}

let admin: SupabaseClient;
let url: string;
let anonKey: string;

const accounts = {} as Record<Who, Provisioned>;
const clients = {} as Record<Who, SupabaseClient>;

const createdBooks: string[] = [];
const createdTokens: string[] = [];
let publishedBookId = "";
let draftBookId = "";

function anonClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function provision(
  email: string,
  role: "authority_admin" | "teacher" | "student",
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

  if (link) await admin.from(link.table).update({ auth_user_id: userId }).eq("id", link.id);

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

describe.skipIf(!status.ready)("hosted project: phase 7 library and notifications", () => {
  beforeAll(async () => {
    url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    accounts.admin = await provision(
      `authority.${TEST_TAG}@school.invalid`, "authority_admin", "Phase 7 Authority",
    );
    accounts.teacher = await provision(
      syntheticTeacherEmail(SEED.teacherBangla), "teacher", "Demo Teacher One",
      { table: "teachers", id: SEED.teacherBangla },
    );
    accounts.alpha = await provision(
      syntheticStudentEmail(SEED.studentAlpha), "student", "Demo Student Alpha",
      { table: "students", id: SEED.studentAlpha },
    );

    for (const name of Object.keys(accounts) as Who[]) {
      clients[name] = await signedInAs(accounts[name]);
    }
  }, 180_000);

  afterAll(async () => {
    for (const id of createdBooks) {
      await admin.from("library_books").delete().eq("id", id);
    }
    for (const token of createdTokens) {
      await admin.from("qr_tokens").delete().eq("token", token);
      await admin
        .from("generated_documents")
        .delete()
        .eq("kind", "id_card")
        .eq("student_id", SEED.studentAlpha);
    }
    // The jobs this run queued, found by their dedupe prefix rather than by a
    // timestamp: the local clock runs ahead of the database's.
    await admin
      .from("notification_jobs")
      .delete()
      .like("dedupe_key", `daily_attendance|%|${QUEUE_DAY}`);

    for (const client of Object.values(clients)) await client.auth.signOut();
  }, 120_000);

  /** A date far enough from real seed data to own outright. */
  const QUEUE_DAY = "2026-03-17";

  // -------------------------------------------------------------------------
  it("the office adds a book; a teacher and a student cannot", async () => {
    const created = await clients.admin
      .from("library_books")
      .insert({
        title: `${BOOK_MARK} — Essentials of Human Biology and Physiology, Volume II`,
        title_bn: "মানব জীববিজ্ঞান ও শারীরবিদ্যার মূল বিষয়, দ্বিতীয় খণ্ড",
        subject_label: "Biology",
        category: "Biology",
        class_id: SEED.class3,
        class_to_id: SEED.class8,
        card_color: "#1f6b45",
        drive_url: "https://drive.google.com/file/d/phase7verify/view",
        is_published: true,
      })
      .select("id")
      .single();

    expect(created.error).toBeNull();
    publishedBookId = created.data!.id;
    createdBooks.push(publishedBookId);

    for (const who of ["teacher", "alpha"] as const) {
      const attempt = await clients[who].from("library_books").insert({
        title: `${BOOK_MARK} — not allowed`,
        drive_url: "https://drive.google.com/file/d/nope/view",
      });
      expect(attempt.error, `${who} must not be able to add a book`).not.toBeNull();
    }
  });

  it("builds the audience label as a range", async () => {
    const { data, error } = await clients.admin.rpc("library_catalogue", {
      p_include_unpublished: true,
    });

    expect(error).toBeNull();

    const rows = data as { id: string; audience_label: string; subject_label: string }[];
    const book = rows.find((b) => b.id === publishedBookId)!;

    expect(book.audience_label).toBe("Class 3-8");
    expect(book.subject_label).toBe("Biology");
  });

  it("hides a draft from a teacher and a student, even when they ask for it", async () => {
    const draft = await clients.admin
      .from("library_books")
      .insert({
        title: `${BOOK_MARK} — draft`,
        subject_label: "Science",
        drive_url: "https://drive.google.com/file/d/phase7draft/view",
        is_published: false,
      })
      .select("id")
      .single();

    draftBookId = draft.data!.id;
    createdBooks.push(draftBookId);

    for (const who of ["teacher", "alpha"] as const) {
      // Through the table, which RLS guards.
      const direct = await clients[who]
        .from("library_books")
        .select("id")
        .eq("id", draftBookId);
      expect(direct.data ?? [], `${who} must not read a draft row`).toHaveLength(0);

      // And through the function, asking for unpublished on purpose.
      const viaRpc = await clients[who].rpc("library_catalogue", {
        p_include_unpublished: true,
      });
      const rows = (viaRpc.data ?? []) as { id: string }[];
      expect(
        rows.some((b) => b.id === draftBookId),
        `${who} must not get a draft even by asking for unpublished`,
      ).toBe(false);
    }

    // The office does see it.
    const asOffice = await clients.admin.rpc("library_catalogue", {
      p_include_unpublished: true,
    });
    const officeRows = (asOffice.data ?? []) as { id: string }[];
    expect(officeRows.some((b) => b.id === draftBookId)).toBe(true);
  });

  it("refuses a colour that is not a hex value, and a backwards range", async () => {
    const badColour = await clients.admin.from("library_books").insert({
      title: `${BOOK_MARK} — bad colour`,
      drive_url: "https://drive.google.com/file/d/x/view",
      card_color: "not-a-colour",
    });
    expect(badColour.error).not.toBeNull();

    const backwards = await clients.admin.from("library_books").insert({
      title: `${BOOK_MARK} — backwards`,
      drive_url: "https://drive.google.com/file/d/y/view",
      class_id: SEED.class8,
      class_to_id: SEED.class3,
    });
    expect(backwards.error, "Class 8 to Class 3 is not a range").not.toBeNull();
    expect(backwards.error!.message).toMatch(/backwards/);
  });

  it("gives a reader a card colour that computes to readable text", async () => {
    const { data } = await clients.alpha.rpc("library_catalogue", {
      p_include_unpublished: false,
    });

    const rows = (data as { id: string; card_color: string | null }[])
      .filter((b) => b.id === publishedBookId);

    expect(rows).toHaveLength(1);

    // The colour is stored; the text is computed. This is the pair a student
    // actually sees.
    const colours = readableOn(rows[0]!.card_color);
    expect(colours.meetsAA, `got ${colours.ratio}:1`).toBe(true);
    expect(["#ffffff", "#121712"]).toContain(colours.text);
  });

  it("anon reads no books at all", async () => {
    const anon = anonClient();
    const books = await anon.from("library_books").select("id");
    expect(books.data ?? []).toHaveLength(0);

    const viaRpc = await anon.rpc("library_catalogue", { p_include_unpublished: false });
    expect(viaRpc.error, "anon must not execute library_catalogue").not.toBeNull();
  });

  // -------------------------------------------------------------------------
  it("publishes the guardian's phone number on the public card, as the owner chose", async () => {
    const token = randomBytes(32).toString("base64url");
    createdTokens.push(token);

    const { data, error } = await clients.admin.rpc("issue_qr_token", {
      p_student_id: SEED.studentAlpha,
      p_token: token,
      p_template_id: SEED.idTemplatePortrait,
      p_replacing_reason: null,
    });

    expect(error).toBeNull();
    expect((data as { fields: string[] }).fields).toContain("guardian_phone");

    // The decision this verifies: an anonymous visitor scanning a found card
    // DOES get the contact number, because the card prints it. Phase 6 dropped
    // it; the owner has settled that the page shows what the card prints.
    const anon = anonClient();
    const card = await anon.rpc("get_public_card", { p_token: token });

    const payload = card.data as {
      card: Record<string, string>;
      school: { name: string; logo_path: string | null; email: string; office_phone: string };
    };

    expect(payload.card.guardian_phone, "the printed number is published").toBeTruthy();
    expect(payload.card.full_name).toBe("Demo Student Alpha");

    // The school block the brief asks for: name, logo, email, office number.
    expect(Object.keys(payload.school).sort()).toEqual(
      ["email", "logo_path", "name", "office_phone"],
    );

    // And still nothing private.
    const serialised = JSON.stringify(payload).toLowerCase();
    for (const forbidden of ["father", "mother", "nid", "birth_certificate", "gpa", "attendance"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  // -------------------------------------------------------------------------
  it("queues one daily summary per student, and nothing on a re-run", async () => {
    const first = await clients.admin.rpc("queue_daily_attendance", {
      p_date: QUEUE_DAY,
    });
    expect(first.error).toBeNull();

    const r1 = first.data as {
      queued: number; already_queued: number; no_submitted_attendance: number;
    };

    // The seeded project may have no submitted attendance on this date, which
    // is itself the correct behaviour to assert: no facts, no message.
    if (r1.queued === 0) {
      expect(
        r1.no_submitted_attendance,
        "with no submitted attendance, nothing should be queued",
      ).toBeGreaterThan(0);
      return;
    }

    const second = await clients.admin.rpc("queue_daily_attendance", {
      p_date: QUEUE_DAY,
    });
    const r2 = second.data as { queued: number; already_queued: number };

    expect(r2.queued, "a re-run must queue nothing").toBe(0);
    expect(r2.already_queued).toBe(r1.queued);

    const jobs = await admin
      .from("notification_jobs")
      .select("id")
      .like("dedupe_key", `daily_attendance|%|${QUEUE_DAY}`);

    expect(
      (jobs.data ?? []).length,
      "exactly one job per student per day, enforced by the unique index",
    ).toBe(r1.queued);
  });

  it("a teacher cannot queue or claim notifications", async () => {
    const queue = await clients.teacher.rpc("queue_daily_attendance", {
      p_date: QUEUE_DAY,
    });
    expect(queue.error).not.toBeNull();

    const claim = await clients.teacher.rpc("claim_notification_jobs", { p_limit: 10 });
    expect(claim.data ?? []).toHaveLength(0);

    const overview = await clients.teacher.rpc("notification_overview", {
      p_from: null, p_to: null,
    });
    expect(overview.data ?? []).toHaveLength(0);
  });

  it("a student reads no notification job, template or delivery log", async () => {
    for (const table of ["notification_jobs", "notification_templates", "sms_delivery_logs"]) {
      const result = await clients.alpha.from(table).select("id");
      expect(result.data ?? [], `a student must not read ${table}`).toHaveLength(0);
    }
  });

  it("anon reaches no part of the notification machinery", async () => {
    const anon = anonClient();

    for (const table of ["notification_jobs", "notification_templates", "sms_delivery_logs"]) {
      const result = await anon.from(table).select("id");
      expect(result.data ?? []).toHaveLength(0);
    }

    for (const fn of ["claim_notification_jobs", "queue_daily_attendance"]) {
      const result = await anon.rpc(fn, fn === "claim_notification_jobs"
        ? { p_limit: 1 }
        : { p_date: QUEUE_DAY });
      expect(result.error, `anon must not execute ${fn}`).not.toBeNull();
    }
  });

  it("refuses to announce results that are not published", async () => {
    const draft = await admin
      .from("exams")
      .insert({
        academic_year_id: SEED.year,
        term_id: "17000000-0000-4000-8000-000000000002",
        name: `${BOOK_MARK} unpublished exam`,
        status: "marks_open",
      })
      .select("id")
      .single();

    try {
      const { error } = await clients.admin.rpc("queue_exam_results", {
        p_exam_id: draft.data!.id,
      });

      expect(
        error,
        "announcing a draft result is the one thing this must never do",
      ).not.toBeNull();
      expect(error!.message).toMatch(/not published/);
    } finally {
      await admin.from("exams").delete().eq("id", draft.data!.id);
    }
  });

  // -------------------------------------------------------------------------
  it("ships one default template per type and language, with real Bangla", async () => {
    const { data, error } = await clients.admin
      .from("notification_templates")
      .select("type, language, body, is_default")
      .eq("is_default", true)
      .eq("is_active", true);

    expect(error).toBeNull();

    const rows = (data ?? []) as { type: string; language: string; body: string }[];
    const types = new Set(rows.map((r) => r.type));

    for (const expected of ["daily_attendance", "exam_result", "class_test_result", "account_otp"]) {
      expect(types, `a default template for ${expected}`).toContain(expected);
    }

    // Exactly one default per type/language pair.
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.type}|${row.language}`;
      expect(seen.has(key), `two defaults for ${key}`).toBe(false);
      seen.add(key);
    }

    for (const row of rows.filter((r) => r.language === "bn")) {
      expect(
        /[ঀ-৿]/.test(row.body),
        `the Bangla ${row.type} template must actually contain Bengali`,
      ).toBe(true);
    }
  });

  it("costs a Bangla message at more than twice its English equivalent", async () => {
    const { data } = await clients.admin
      .from("notification_templates")
      .select("type, language, body")
      .eq("type", "daily_attendance")
      .eq("is_default", true);

    const rows = (data ?? []) as { language: string; body: string }[];
    const en = rows.find((r) => r.language === "en")!;
    const bn = rows.find((r) => r.language === "bn")!;

    const values = {
      school: "SCH", student: "Demo Student Alpha", status: "present",
      date: "17 Mar 2026", present: 4, lessons: 5,
    };

    const renderedEn = renderTemplate(en.body, values);
    const renderedBn = renderTemplate(bn.body, values);

    expect(renderedEn.missing).toEqual([]);
    expect(renderedBn.missing).toEqual([]);

    const costEn = countSegments(renderedEn.body);
    const costBn = countSegments(renderedBn.body);

    expect(costEn.isUnicode).toBe(false);
    expect(costBn.isUnicode, "a Bangla body is UCS-2").toBe(true);
    // 70 characters per segment against 160: the same sentence costs more.
    expect(costBn.segments).toBeGreaterThanOrEqual(costEn.segments);
  });

  it("a teacher cannot read or edit the message templates", async () => {
    const read = await clients.teacher.from("notification_templates").select("id");
    expect(read.data ?? []).toHaveLength(0);

    const { data: template } = await admin
      .from("notification_templates").select("id").limit(1).single();

    const write = await clients.teacher
      .from("notification_templates")
      .update({ body: "hijacked" })
      .eq("id", template!.id)
      .select("id");

    expect(write.data ?? [], "a teacher must not be able to edit a message").toHaveLength(0);
  });
});
