/**
 * OTP activation and recovery, against the REAL hosted project.
 *
 * Exercises the actual issue/verify code against real tables, because the
 * guarantees worth checking are about what is STORED and what is REFUSED:
 * the code is never persisted in clear, a wrong code does not destroy the
 * challenge, an expired one is refused, and a second request invalidates the
 * first.
 *
 * SMS is in simulate mode throughout. Nothing is sent to any phone. The test
 * reads the code from the simulated delivery log, which is exactly how a
 * developer completes the flow locally — and is also why this is a development
 * simulation and not a working SMS feature.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remoteCredentialStatus } from "./load-env.mjs";

const status = remoteCredentialStatus();

// Loaded after the env check so the module-level env validation has values.
let issueOtp: typeof import("@/lib/auth/otp").issueOtp;
let verifyOtp: typeof import("@/lib/auth/otp").verifyOtp;
let sendSms: typeof import("@/lib/sms").sendSms;
let smsIsSimulated: typeof import("@/lib/sms").smsIsSimulated;

const SEED_STUDENT = "57000000-0000-4000-8000-000000000001";
const SEED_TEACHER = "7eac0000-0000-4000-8000-000000000001";

let admin: SupabaseClient;

/** Clears rate-limit rows for an identifier so one test cannot starve another. */
async function clearGate(identifier: string) {
  await admin.from("auth_attempts").delete().eq("identifier", identifier.toLowerCase());
}

async function clearChallenges() {
  await admin.from("otp_challenges").delete().eq("student_id", SEED_STUDENT);
  await admin.from("otp_challenges").delete().eq("teacher_id", SEED_TEACHER);
}

describe.skipIf(!status.ready)("OTP on the hosted project", () => {
  beforeAll(async () => {
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    ({ issueOtp, verifyOtp } = await import("@/lib/auth/otp"));
    ({ sendSms, smsIsSimulated } = await import("@/lib/sms"));

    await clearChallenges();
  }, 120_000);

  afterAll(async () => {
    await clearChallenges();
    await clearGate("STU-2026-0001");
    await clearGate("T-001");
    await clearGate("otp-test-expiry");
  });

  // -------------------------------------------------------------------------
  it("is in simulate mode, so no SMS is actually sent", () => {
    // If this ever reports false in development, the labelling in the UI and in
    // every report would be wrong, so it is asserted rather than assumed.
    expect(smsIsSimulated()).toBe(true);
  });

  // -------------------------------------------------------------------------
  describe("issuing a code", () => {
    it("stores a hash, never the code itself", async () => {
      await clearGate("STU-2026-0001");
      await clearChallenges();

      const issued = await issueOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        "+8801300000301",
        "STU-2026-0001",
      );

      expect(issued.ok).toBe(true);
      if (!issued.ok) return;

      const { data } = await admin
        .from("otp_challenges")
        .select("code_hash, expires_at, attempts, phone")
        .eq("student_id", SEED_STUDENT)
        .is("consumed_at", null)
        .single();

      // The stored value is a 64-char hex digest, and is NOT the code.
      expect(data!.code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(data!.code_hash).not.toContain(issued.code);
      expect(data!.attempts).toBe(0);
      expect(new Date(data!.expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it("a second request invalidates the first code", async () => {
      await clearGate("STU-2026-0001");
      await clearChallenges();

      const first = await issueOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        "+8801300000301",
        "STU-2026-0001",
      );
      const second = await issueOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        "+8801300000301",
        "STU-2026-0001",
      );

      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      // Exactly one live challenge remains.
      const { count } = await admin
        .from("otp_challenges")
        .select("id", { count: "exact", head: true })
        .eq("student_id", SEED_STUDENT)
        .is("consumed_at", null);
      expect(count).toBe(1);

      // The old code no longer works.
      const old = await verifyOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        first.code,
        "STU-2026-0001",
      );
      expect(old.ok).toBe(false);

      // The new one does.
      const fresh = await verifyOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        second.code,
        "STU-2026-0001",
      );
      expect(fresh.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("verifying a code", () => {
    it("accepts the right code and consumes the challenge", async () => {
      await clearGate("STU-2026-0001");
      await clearChallenges();

      const issued = await issueOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        "+8801300000301",
        "STU-2026-0001",
      );
      if (!issued.ok) throw new Error("could not issue");

      const result = await verifyOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        issued.code,
        "STU-2026-0001",
      );

      expect(result.ok).toBe(true);

      // Consumed, so it cannot be replayed.
      const replay = await verifyOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        issued.code,
        "STU-2026-0001",
      );
      expect(replay.ok).toBe(false);
      if (!replay.ok) expect(replay.reason).toBe("no_challenge");
    });

    it("a wrong code increments attempts without destroying the challenge", async () => {
      await clearGate("STU-2026-0001");
      await clearChallenges();

      const issued = await issueOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        "+8801300000301",
        "STU-2026-0001",
      );
      if (!issued.ok) throw new Error("could not issue");

      const wrong = issued.code === "000000" ? "111111" : "000000";
      const bad = await verifyOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        wrong,
        "STU-2026-0001",
      );

      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.reason).toBe("wrong_code");

      const { data } = await admin
        .from("otp_challenges")
        .select("attempts")
        .eq("student_id", SEED_STUDENT)
        .is("consumed_at", null)
        .single();
      expect(data!.attempts).toBe(1);

      // A mistyped digit must not force a new SMS: the real code still works.
      const good = await verifyOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        issued.code,
        "STU-2026-0001",
      );
      expect(good.ok).toBe(true);
    });

    it("refuses a code after too many wrong attempts", async () => {
      await clearGate("STU-2026-0001");
      await clearChallenges();

      const issued = await issueOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        "+8801300000301",
        "STU-2026-0001",
      );
      if (!issued.ok) throw new Error("could not issue");

      // Drive the challenge's own counter to its maximum.
      await admin
        .from("otp_challenges")
        .update({ attempts: 5 })
        .eq("student_id", SEED_STUDENT)
        .is("consumed_at", null);

      const result = await verifyOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        issued.code,
        "STU-2026-0001",
      );

      expect(result.ok).toBe(false);
      // Even the CORRECT code is refused once the challenge is exhausted.
      if (!result.ok) expect(result.reason).toBe("too_many_attempts");
    });

    it("refuses an expired code", async () => {
      await clearGate("STU-2026-0001");
      await clearChallenges();

      const issued = await issueOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        "+8801300000301",
        "STU-2026-0001",
      );
      if (!issued.ok) throw new Error("could not issue");

      await admin
        .from("otp_challenges")
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq("student_id", SEED_STUDENT)
        .is("consumed_at", null);

      const result = await verifyOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        issued.code,
        "STU-2026-0001",
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("expired");
    });

    it("a student's code does not work for a teacher's challenge", async () => {
      await clearGate("STU-2026-0001");
      await clearGate("T-001");
      await clearChallenges();

      const studentCode = await issueOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        "+8801300000301",
        "STU-2026-0001",
      );
      const teacherCode = await issueOtp(
        { kind: "teacher", teacherId: SEED_TEACHER },
        "activation",
        "+8801300000101",
        "T-001",
      );

      if (!studentCode.ok || !teacherCode.ok) throw new Error("could not issue");

      // The digest is keyed on purpose and phone, so a code is bound to its own
      // challenge and cannot be replayed against another subject.
      const crossed = await verifyOtp(
        { kind: "teacher", teacherId: SEED_TEACHER },
        "activation",
        studentCode.code,
        "T-001",
      );

      expect(crossed.ok).toBe(false);
    });

    it("an activation code does not work for a password reset", async () => {
      await clearGate("STU-2026-0001");
      await clearChallenges();

      const issued = await issueOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        "+8801300000301",
        "STU-2026-0001",
      );
      if (!issued.ok) throw new Error("could not issue");

      const wrongPurpose = await verifyOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "password_reset",
        issued.code,
        "STU-2026-0001",
      );

      expect(wrongPurpose.ok).toBe(false);
      if (!wrongPurpose.ok) expect(wrongPurpose.reason).toBe("no_challenge");
    });
  });

  // -------------------------------------------------------------------------
  describe("simulated delivery", () => {
    /**
     * A unique destination per test, used to find that test's own log row.
     *
     * Deliberately NOT a timestamp filter: the local clock here runs about 24
     * seconds ahead of the database, so `attempted_at >= <client now>` excludes
     * the row the test just wrote. Matching on a value the test itself chose is
     * clock-independent.
     */
    function uniqueDestination(): string {
      const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
      return `+88013${digits}`;
    }

    it("records the message without sending it, and marks it simulated", async () => {
      const to = uniqueDestination();

      const result = await sendSms({
        to,
        body: "Your School account activation code is 123456. It expires in 10 minutes.",
        kind: "account_otp",
      });

      expect(result.mode).toBe("simulate");
      // Nothing was delivered — the caller must not report success.
      expect(result.delivered).toBe(false);
      expect(result.segments).toBe(1);
      // The attempt WAS recorded. Before migration 0023, job_id was NOT NULL
      // and every OTP send failed to log while still reporting success, which
      // is why `logged` is now part of the result and asserted here.
      expect(result.logged).toBe(true);
      expect(result.error).toBeUndefined();

      const { data } = await admin
        .from("sms_delivery_logs")
        .select("id, mode, status, segments, request_payload")
        .eq("request_payload->>to", to)
        .limit(1);

      expect(data?.[0]?.mode).toBe("simulate");
      expect(data?.[0]?.status).toBe("simulated");

      const payload = data?.[0]?.request_payload as Record<string, unknown>;
      expect(String(payload.note)).toMatch(/SIMULATED/i);
      // The body is readable in simulate mode on purpose, so a developer can
      // complete the flow. In live mode this is redacted for OTP traffic.
      expect(String(payload.body)).toContain("123456");

      await admin.from("sms_delivery_logs").delete().eq("id", data![0]!.id);
    });

    it("counts Bangla segments correctly in a recorded send", async () => {
      const to = uniqueDestination();

      // 160 Bangla characters: three billable segments, not one.
      const result = await sendSms({
        to,
        body: "অ".repeat(160),
        kind: "custom",
      });

      expect(result.isUnicode).toBe(true);
      expect(result.segments).toBe(3);
      expect(result.logged).toBe(true);

      const { data } = await admin
        .from("sms_delivery_logs")
        .select("id, segments")
        .eq("request_payload->>to", to)
        .limit(1);

      expect(data?.[0]?.segments).toBe(3);

      await admin.from("sms_delivery_logs").delete().eq("id", data![0]!.id);
    });
  });

  // -------------------------------------------------------------------------
  describe("rate limiting", () => {
    it("stops repeated code requests for one identifier", async () => {
      const identifier = "otp-test-expiry";
      await clearGate(identifier);
      await clearChallenges();

      // The limiter counts FAILED attempts, so drive failures directly.
      const rows = Array.from({ length: 5 }, () => ({
        identifier,
        kind: "otp_request" as const,
        succeeded: false,
      }));
      await admin.from("auth_attempts").insert(rows);

      const blocked = await issueOtp(
        { kind: "student", studentId: SEED_STUDENT },
        "activation",
        "+8801300000301",
        identifier,
      );

      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.reason).toBe("rate_limited");

      await clearGate(identifier);
    });
  });
});

if (!status.ready) {
  describe("OTP on the hosted project", () => {
    it.skip(`skipped — .env.local is missing: ${status.missing.join(", ")}`, () => {});
  });
}
