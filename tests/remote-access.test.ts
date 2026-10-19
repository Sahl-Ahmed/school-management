/**
 * Verification against the REAL hosted Supabase project.
 *
 * This is the suite that answers "does it actually work in production", as
 * distinct from tests/access-rules.test.mjs, which proves the policies are
 * correct against a local Postgres. The two are complementary: this one
 * exercises genuine sign-in, real JWTs, PostgREST and the live schema.
 *
 * It SKIPS ENTIRELY unless .env.local carries real credentials, so
 * `npm test` stays runnable on a machine with no Supabase project.
 *
 * What it writes to the project:
 *   * Auth users for the seeded demo people, with random passwords generated
 *     in memory and never printed or stored.
 *   * Matching rows in public.profiles.
 *   * One qr_token for the demo student.
 * All of it is removable with `npm run test:remote:cleanup`. It touches no real
 * student data because the seed is entirely synthetic.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remoteCredentialStatus } from "./load-env.mjs";
import {
  syntheticStudentEmail,
  syntheticTeacherEmail,
} from "@/lib/auth/email-convention";

const status = remoteCredentialStatus();

// Fixed ids from supabase/seed.sql.
const SEED = {
  studentAlpha: "57000000-0000-4000-8000-000000000001",
  studentBeta: "57000000-0000-4000-8000-000000000002",
  siblingElder: "57000000-0000-4000-8000-000000000003",
  siblingYounger: "57000000-0000-4000-8000-000000000004",
  teacherOne: "7eac0000-0000-4000-8000-000000000001",
  teacherThree: "7eac0000-0000-4000-8000-000000000003",
} as const;

/** Marks every account this suite creates, so cleanup can find them. */
const TEST_TAG = "phase1-verification";

type Provisioned = { userId: string; email: string; password: string };

function strongPassword(): string {
  // Generated per run, held in memory only, never printed.
  return `Vf-${randomBytes(18).toString("base64url")}`;
}

let admin: SupabaseClient;
let url: string;
let anonKey: string;
const created: string[] = [];
const accounts: Record<string, Provisioned> = {};

/** A fresh client carrying only the anon key — what a browser gets. */
function anonClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Creates (or reuses) an auth user and its profile, returning credentials. */
async function provision(
  email: string,
  role: "authority_admin" | "teacher" | "student",
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
    // Already exists from a previous run: find it and reset the password so
    // this run can sign in.
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email === email);
    if (!existing) throw new Error(`could not create or find ${email}: ${error.message}`);
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  } else {
    userId = data.user!.id;
    created.push(userId);
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

/** Signs in and returns a client bound to that user's real session. */
async function signedInAs(who: Provisioned): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: who.email,
    password: who.password,
  });
  if (error) throw new Error(`sign-in failed for ${who.email}: ${error.message}`);
  return client;
}

describe.skipIf(!status.ready)("hosted Supabase project", () => {
  beforeAll(async () => {
    url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    accounts.authority = await provision(
      `authority.${TEST_TAG}@school.invalid`,
      "authority_admin",
      "Verification Authority",
    );
    accounts.teacherOne = await provision(
      syntheticTeacherEmail(SEED.teacherOne),
      "teacher",
      "Demo Teacher One",
      { table: "teachers", id: SEED.teacherOne },
    );
    accounts.studentAlpha = await provision(
      syntheticStudentEmail(SEED.studentAlpha),
      "student",
      "Demo Student Alpha",
      { table: "students", id: SEED.studentAlpha },
    );
    accounts.siblingElder = await provision(
      syntheticStudentEmail(SEED.siblingElder),
      "student",
      "Demo Sibling Elder",
      { table: "students", id: SEED.siblingElder },
    );
    accounts.siblingYounger = await provision(
      syntheticStudentEmail(SEED.siblingYounger),
      "student",
      "Demo Sibling Younger",
      { table: "students", id: SEED.siblingYounger },
    );
  }, 180_000);

  afterAll(async () => {
    // Sessions are not persisted, so nothing to sign out. Accounts are left in
    // place unless cleanup is run explicitly, so a failed run can be inspected.
  });

  // -------------------------------------------------------------------------
  describe("schema", () => {
    it("has the migrations applied", async () => {
      const { data, error } = await admin.rpc("admit_card_eligibility", {
        p_student_id: SEED.studentAlpha,
        p_exam_id: randomUUID(),
      });

      // A nonexistent exam resolves to a structured refusal, which proves the
      // function exists and runs on the live project.
      expect(error).toBeNull();
      expect(data).toMatchObject({ eligible: false });
    });

    it("has the synthetic seed loaded", async () => {
      const { count } = await admin
        .from("students")
        .select("id", { count: "exact", head: true });

      expect(count ?? 0).toBeGreaterThanOrEqual(5);
    });

    it("still has two siblings sharing one guardian phone", async () => {
      const { data } = await admin
        .from("student_contacts")
        .select("phone, student_id")
        .eq("is_sms_target", true);

      const byPhone = new Map<string, number>();
      for (const row of data ?? []) {
        byPhone.set(row.phone, (byPhone.get(row.phone) ?? 0) + 1);
      }

      expect([...byPhone.values()].some((n) => n > 1)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("sign-in", () => {
    it("an authority can sign in and read school-wide data", async () => {
      const client = await signedInAs(accounts.authority!);

      const { data: user } = await client.auth.getUser();
      expect(user.user?.id).toBe(accounts.authority!.userId);

      const { count } = await client
        .from("students")
        .select("id", { count: "exact", head: true });
      expect(count ?? 0).toBeGreaterThanOrEqual(5);
    });

    it("a student can sign in with the registration-number mapping", async () => {
      // Resolves the registration number exactly as the login action does,
      // then signs in with the resulting synthetic address.
      const { data: student } = await admin
        .from("students")
        .select("id")
        .ilike("registration_no", "STU-2026-0001")
        .maybeSingle();

      expect(student?.id).toBe(SEED.studentAlpha);

      const client = anonClient();
      const { error } = await client.auth.signInWithPassword({
        email: syntheticStudentEmail(student!.id),
        password: accounts.studentAlpha!.password,
      });
      expect(error).toBeNull();
    });

    it("a wrong password is refused", async () => {
      const client = anonClient();
      const { error } = await client.auth.signInWithPassword({
        email: accounts.studentAlpha!.email,
        password: "definitely-not-the-password",
      });

      expect(error).not.toBeNull();
    });

    it("a teacher can sign in", async () => {
      const client = await signedInAs(accounts.teacherOne!);
      const { data } = await client.auth.getUser();
      expect(data.user?.id).toBe(accounts.teacherOne!.userId);
    });
  });

  // -------------------------------------------------------------------------
  describe("student isolation on the live project", () => {
    it("a student reads only their own record", async () => {
      const client = await signedInAs(accounts.studentAlpha!);

      const { data } = await client.from("students").select("id, registration_no");

      expect(data).toHaveLength(1);
      expect(data![0]!.id).toBe(SEED.studentAlpha);
    });

    it("filtering by another student's registration number returns nothing", async () => {
      const client = await signedInAs(accounts.studentAlpha!);

      const { data } = await client
        .from("students")
        .select("id")
        .eq("registration_no", "STU-2026-0003");

      expect(data).toHaveLength(0);
    });

    it("a student cannot read another student's fees", async () => {
      const client = await signedInAs(accounts.studentAlpha!);

      const { data } = await client
        .from("fee_charges")
        .select("id")
        .eq("student_id", SEED.siblingElder);

      expect(data).toHaveLength(0);
    });

    it("a student cannot read private identifiers at all", async () => {
      const client = await signedInAs(accounts.studentAlpha!);

      const { data } = await client.from("student_private_ids").select("student_id");

      expect(data ?? []).toHaveLength(0);
    });

    it("a student cannot change their own registration number", async () => {
      const client = await signedInAs(accounts.studentAlpha!);

      await client
        .from("students")
        .update({ registration_no: "HACKED" })
        .eq("id", SEED.studentAlpha);

      const { data } = await admin
        .from("students")
        .select("registration_no")
        .eq("id", SEED.studentAlpha)
        .single();

      expect(data!.registration_no).toBe("STU-2026-0001");
    });

    it("siblings sharing a phone still see only their own record", async () => {
      const elder = await signedInAs(accounts.siblingElder!);
      const younger = await signedInAs(accounts.siblingYounger!);

      const { data: e } = await elder.from("students").select("id");
      const { data: y } = await younger.from("students").select("id");

      expect(e).toEqual([{ id: SEED.siblingElder }]);
      expect(y).toEqual([{ id: SEED.siblingYounger }]);
    });
  });

  // -------------------------------------------------------------------------
  describe("teacher scope on the live project", () => {
    it("a teacher sees only students in assigned sections", async () => {
      const client = await signedInAs(accounts.teacherOne!);

      const { data } = await client.from("students").select("id");
      const visible = (data ?? []).map((r) => r.id);

      expect(visible).toContain(SEED.studentAlpha);
      expect(visible).toContain(SEED.studentBeta);
      expect(visible).not.toContain(SEED.siblingElder);
      expect(visible).not.toContain(SEED.siblingYounger);
    });

    it("a teacher cannot read fees or guardian phones", async () => {
      const client = await signedInAs(accounts.teacherOne!);

      const { data: fees } = await client.from("fee_charges").select("id");
      const { data: contacts } = await client.from("student_contacts").select("phone");
      const { data: nids } = await client
        .from("student_private_ids")
        .select("father_nid");

      expect(fees ?? []).toHaveLength(0);
      expect(contacts ?? []).toHaveLength(0);
      expect(nids ?? []).toHaveLength(0);
    });

    it("a teacher cannot read feedback answers", async () => {
      const client = await signedInAs(accounts.teacherOne!);

      const { data: responses } = await client.from("feedback_responses").select("id");
      const { data: comments } = await client.from("feedback_comments").select("id");
      const { data: completions } = await client
        .from("feedback_completions")
        .select("id");

      expect(responses ?? []).toHaveLength(0);
      expect(comments ?? []).toHaveLength(0);
      expect(completions ?? []).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("anonymous access on the live project", () => {
    it("the anon key reads no table", async () => {
      const client = anonClient();

      for (const table of [
        "students",
        "student_contacts",
        "student_private_ids",
        "qr_tokens",
        "fee_charges",
        "marks",
        "audit_logs",
      ]) {
        const { data, error } = await client.from(table).select("*").limit(1);
        // Either refused outright, or allowed-but-empty. Never rows.
        expect(error ? true : (data ?? []).length === 0).toBe(true);
      }
    });

    it("the public QR card resolves and exposes only card fields", async () => {
      const token = `qr_${randomBytes(24).toString("hex")}`;

      await admin.from("qr_tokens").insert({
        token,
        student_id: SEED.studentAlpha,
        card_snapshot: {
          full_name: "Demo Student Alpha",
          registration_no: "STU-2026-0001",
          roll_no: 1,
          class_name: "Class 3",
          section_name: "A",
          blood_group: "B+",
        },
      });

      const client = anonClient();
      const { data, error } = await client.rpc("get_public_card", { p_token: token });

      expect(error).toBeNull();
      expect(data).not.toBeNull();

      const serialised = JSON.stringify(data).toLowerCase();
      for (const forbidden of [
        "father",
        "mother",
        "nid",
        "birth_certificate",
        "fee",
        "gpa",
        "attendance",
        "password",
      ]) {
        expect(serialised).not.toContain(forbidden);
      }

      // Revoking must take effect immediately.
      await admin
        .from("qr_tokens")
        .update({ revoked_at: new Date().toISOString(), revoke_reason: "verification" })
        .eq("token", token);

      const { data: afterRevoke } = await anonClient().rpc("get_public_card", {
        p_token: token,
      });
      expect(afterRevoke).toBeNull();

      await admin.from("qr_tokens").delete().eq("token", token);
    });

    it("the database refuses a card snapshot with forbidden fields", async () => {
      const { error } = await admin.from("qr_tokens").insert({
        token: `qr_${randomBytes(24).toString("hex")}`,
        student_id: SEED.studentBeta,
        card_snapshot: { full_name: "X", father_name: "Should Not Be Here" },
      });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/father_name/);
    });
  });

  // -------------------------------------------------------------------------
  describe("audit on the live project", () => {
    /**
     * Returns the current highest audit_logs id, for use as a watermark.
     *
     * Rows are selected with `id > watermark` rather than
     * `occurred_at >= <client timestamp>`, because the two clocks are not the
     * same clock. On the machine this was written, the local clock ran about
     * 24 seconds ahead of the database, so a timestamp filter silently
     * excluded the row the test had just caused to be written. audit_logs.id
     * is a bigint identity, so it is monotonic and entirely server-side.
     */
    async function auditWatermark(): Promise<number> {
      const { data } = await admin
        .from("audit_logs")
        .select("id")
        .order("id", { ascending: false })
        .limit(1);

      return data?.[0]?.id ?? 0;
    }

    it("records an authority change with the acting user", async () => {
      const client = await signedInAs(accounts.authority!);

      // The trigger deliberately skips an UPDATE that changes nothing, so the
      // new value must differ from the current one. Hard-coding a value made
      // this test pass on a fresh project and fail on the second run.
      const { data: before } = await admin
        .from("students")
        .select("blood_group")
        .eq("id", SEED.studentBeta)
        .single();

      const next = before!.blood_group === "O-" ? "B-" : "O-";
      const watermark = await auditWatermark();

      const { error } = await client
        .from("students")
        .update({ blood_group: next })
        .eq("id", SEED.studentBeta);
      expect(error).toBeNull();

      // Scoped to this run, so a row left by an earlier run cannot satisfy it.
      const { data } = await admin
        .from("audit_logs")
        .select("actor_id, actor_role, actor_name, action, changed_fields")
        .eq("table_name", "students")
        .eq("record_id", SEED.studentBeta)
        .gt("id", watermark)
        .order("id", { ascending: false })
        .limit(1);

      expect(data?.[0]?.actor_id).toBe(accounts.authority!.userId);
      expect(data?.[0]?.actor_role).toBe("authority_admin");
      expect(data?.[0]?.changed_fields).toContain("blood_group");
    });

    it("an UPDATE that changes nothing writes no audit row", async () => {
      const client = await signedInAs(accounts.authority!);

      const { data: current } = await admin
        .from("students")
        .select("blood_group")
        .eq("id", SEED.studentBeta)
        .single();

      const watermark = await auditWatermark();

      // Same value back again.
      await client
        .from("students")
        .update({ blood_group: current!.blood_group })
        .eq("id", SEED.studentBeta);

      const { data } = await admin
        .from("audit_logs")
        .select("id")
        .eq("table_name", "students")
        .eq("record_id", SEED.studentBeta)
        .gt("id", watermark);

      expect(data ?? []).toHaveLength(0);
    });

    it("attribution survives deletion of the acting account", async () => {
      // The reason actor_id carries no foreign key. A deleted account must not
      // erase who made a change.
      const throwaway = await provision(
        `transient.${TEST_TAG}@school.invalid`,
        "authority_admin",
        "Transient Authority",
      );

      const client = await signedInAs(throwaway);
      const watermark = await auditWatermark();

      await client
        .from("students")
        .update({ full_name_bn: `যাচাই ${Date.now()}` })
        .eq("id", SEED.studentBeta);

      const { data: logged } = await admin
        .from("audit_logs")
        .select("id, actor_id, actor_name")
        .eq("table_name", "students")
        .eq("record_id", SEED.studentBeta)
        .gt("id", watermark)
        .order("id", { ascending: false })
        .limit(1);

      expect(logged?.[0]?.actor_id).toBe(throwaway.userId);
      expect(logged?.[0]?.actor_name).toBe("Transient Authority");

      // Now remove the account entirely, as cleanup would.
      await admin.from("profiles").delete().eq("id", throwaway.userId);
      await admin.auth.admin.deleteUser(throwaway.userId);

      const { data: after } = await admin
        .from("audit_logs")
        .select("actor_id, actor_name, actor_role")
        .eq("id", logged![0]!.id)
        .single();

      expect(after!.actor_id).toBe(throwaway.userId);
      expect(after!.actor_name).toBe("Transient Authority");
      expect(after!.actor_role).toBe("authority_admin");
    });
  });
});

// Reported once when the suite is skipped, so a skip is never mistaken for a pass.
if (!status.ready) {
  describe("hosted Supabase project", () => {
    it.skip(
      `skipped — .env.local is missing: ${status.missing.join(", ")}`,
      () => {},
    );
  });
}
