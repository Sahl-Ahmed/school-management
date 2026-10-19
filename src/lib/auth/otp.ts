import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * One-time codes for account activation and password recovery.
 *
 * Rules this module enforces, each for a stated reason:
 *
 *   * The code is stored only as an HMAC-SHA256 digest. A database dump, a
 *     leaked backup or a careless SELECT must not hand anyone a live code.
 *   * The HMAC is keyed with the service role key rather than a plain hash, so
 *     an attacker holding only the database cannot brute-force a six-digit
 *     space offline — they would need the key too, which lives in the server's
 *     environment.
 *   * Verification is constant-time, so response timing does not leak how much
 *     of a code was correct.
 *   * Codes expire, and attempts are counted on the challenge itself, so a
 *     single challenge cannot be ground down by repeated guesses.
 *   * Requests and verifications are both rate-limited per identifier.
 *
 * The code itself is generated with crypto.randomInt, never Math.random.
 */

const CODE_LENGTH = 6;
const TTL_MINUTES = 10;
const MAX_VERIFY_ATTEMPTS = 5;

/** OTP requests allowed per identifier per window, to limit SMS spend and abuse. */
const REQUEST_LIMIT = { attempts: 5, windowMinutes: 30 };
const VERIFY_LIMIT = { attempts: 10, windowMinutes: 30 };

export type OtpPurpose = "activation" | "password_reset" | "phone_change";

export type OtpSubject =
  | { kind: "student"; studentId: string }
  | { kind: "teacher"; teacherId: string };

function hmacKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to hash OTP codes");
  return key;
}

/** Digest of a code. Deterministic, so verification can compare digests. */
function digest(code: string, purpose: OtpPurpose, phone: string): string {
  return createHmac("sha256", hmacKey())
    .update(`${purpose}:${phone}:${code}`)
    .digest("hex");
}

/** A numeric code of CODE_LENGTH digits, zero-padded, uniformly distributed. */
function generateCode(): string {
  const max = 10 ** CODE_LENGTH;
  return String(randomInt(0, max)).padStart(CODE_LENGTH, "0");
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Records an attempt and reports whether the identifier is currently limited. */
async function gate(
  identifier: string,
  kind: "otp_request" | "otp_verify",
  limit: { attempts: number; windowMinutes: number },
): Promise<{ limited: boolean; record: (ok: boolean) => Promise<void> }> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - limit.windowMinutes * 60_000).toISOString();

  const { count } = await admin
    .from("auth_attempts")
    .select("id", { count: "exact", head: true })
    .eq("identifier", identifier.toLowerCase())
    .eq("kind", kind)
    .eq("succeeded", false)
    .gte("attempted_at", since);

  return {
    limited: (count ?? 0) >= limit.attempts,
    record: async (ok: boolean) => {
      await admin.from("auth_attempts").insert({
        identifier: identifier.toLowerCase(),
        kind,
        succeeded: ok,
      });
    },
  };
}

export type IssueResult =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; reason: "rate_limited" | "no_phone" | "failed" };

/**
 * Creates a challenge and returns the plaintext code TO THE CALLER ONLY, so it
 * can be handed straight to the SMS adapter. The code is never persisted and
 * never returned to the browser.
 */
export async function issueOtp(
  subject: OtpSubject,
  purpose: OtpPurpose,
  phone: string,
  identifier: string,
): Promise<IssueResult> {
  const admin = createAdminClient();

  const limiter = await gate(identifier, "otp_request", REQUEST_LIMIT);
  if (limiter.limited) return { ok: false, reason: "rate_limited" };

  if (!phone) return { ok: false, reason: "no_phone" };

  const code = generateCode();
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  const subjectColumn =
    subject.kind === "student" ? "student_id" : "teacher_id";
  const subjectId =
    subject.kind === "student" ? subject.studentId : subject.teacherId;

  // A partial unique index allows only one unconsumed challenge per subject and
  // purpose, so any earlier live challenge is retired first. Requesting a new
  // code therefore invalidates the previous one, which is the behaviour users
  // expect and stops two codes being valid at once.
  await admin
    .from("otp_challenges")
    .delete()
    .eq(subjectColumn, subjectId)
    .eq("purpose", purpose)
    .is("consumed_at", null);

  const { error } = await admin.from("otp_challenges").insert({
    purpose,
    [subjectColumn]: subjectId,
    phone,
    code_hash: digest(code, purpose, phone),
    expires_at: expiresAt,
    max_attempts: MAX_VERIFY_ATTEMPTS,
  });

  if (error) {
    await limiter.record(false);
    return { ok: false, reason: "failed" };
  }

  await limiter.record(true);
  return { ok: true, code, expiresAt };
}

export type VerifyResult =
  | { ok: true; subjectId: string; phone: string }
  | {
      ok: false;
      reason: "rate_limited" | "no_challenge" | "expired" | "too_many_attempts" | "wrong_code";
    };

/**
 * Checks a submitted code and consumes the challenge on success.
 *
 * On a wrong code the attempt counter is incremented rather than the challenge
 * being destroyed, so a mistyped digit does not force a new SMS, while repeated
 * guessing still exhausts the challenge.
 */
export async function verifyOtp(
  subject: OtpSubject,
  purpose: OtpPurpose,
  code: string,
  identifier: string,
): Promise<VerifyResult> {
  const admin = createAdminClient();

  const limiter = await gate(identifier, "otp_verify", VERIFY_LIMIT);
  if (limiter.limited) return { ok: false, reason: "rate_limited" };

  const subjectColumn = subject.kind === "student" ? "student_id" : "teacher_id";
  const subjectId = subject.kind === "student" ? subject.studentId : subject.teacherId;

  const { data: challenge } = await admin
    .from("otp_challenges")
    .select("id, phone, code_hash, expires_at, attempts, max_attempts")
    .eq(subjectColumn, subjectId)
    .eq("purpose", purpose)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!challenge) {
    await limiter.record(false);
    return { ok: false, reason: "no_challenge" };
  }

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    await limiter.record(false);
    return { ok: false, reason: "expired" };
  }

  if (challenge.attempts >= challenge.max_attempts) {
    await limiter.record(false);
    return { ok: false, reason: "too_many_attempts" };
  }

  const matches = constantTimeEquals(
    challenge.code_hash,
    digest(code.trim(), purpose, challenge.phone),
  );

  if (!matches) {
    await admin
      .from("otp_challenges")
      .update({ attempts: challenge.attempts + 1 })
      .eq("id", challenge.id);

    await limiter.record(false);
    return { ok: false, reason: "wrong_code" };
  }

  await admin
    .from("otp_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", challenge.id);

  await limiter.record(true);
  return { ok: true, subjectId, phone: challenge.phone };
}

/** How long a freshly issued code remains valid, for display in the UI. */
export const OTP_TTL_MINUTES = TTL_MINUTES;
export const OTP_CODE_LENGTH = CODE_LENGTH;
