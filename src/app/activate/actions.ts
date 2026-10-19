"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueOtp, verifyOtp, OTP_TTL_MINUTES, type OtpSubject } from "@/lib/auth/otp";
import { sendSms, smsIsSimulated } from "@/lib/sms";
import {
  syntheticStudentEmail,
  syntheticTeacherEmail,
} from "@/lib/auth/email-convention";

/**
 * First-login activation and password recovery.
 *
 * Both flows are the same three steps — identify, verify a code sent to the
 * phone on record, choose a password — and both are implemented here so the
 * two cannot drift apart in their handling of rate limits and error messages.
 *
 * Privacy rule applied throughout: an unknown registration number and a known
 * one produce the SAME response. Registration numbers are printed on ID cards,
 * so a form that distinguished them would let anyone test which exist. The
 * phone number is echoed back only in masked form (01712•••678) so the person
 * can confirm which number was used without the form revealing a full number
 * to someone who guessed an identifier.
 */

export type ActivationState = {
  step?: "identify" | "code" | "password" | "done";
  error?: string;
  notice?: string;
  /** Masked destination, e.g. 01712•••678. Never the full number. */
  maskedPhone?: string;
  /** True when no SMS provider is connected and the code was not really sent. */
  simulated?: boolean;
  /** Carried between steps so the user does not retype it. */
  identifier?: string;
  role?: "student" | "teacher";
};

const GENERIC = "Those details did not match our records.";

/** 01712345678 -> 01712•••678 */
function maskPhone(e164: string): string {
  const local = e164.startsWith("+88") ? e164.slice(3) : e164;
  if (local.length < 8) return "•••";
  return `${local.slice(0, 5)}•••${local.slice(-3)}`;
}

const identifySchema = z.object({
  role: z.enum(["student", "teacher"]),
  identifier: z.string().trim().min(1).max(64),
  purpose: z.enum(["activation", "password_reset"]),
});

type Resolved = {
  subject: OtpSubject;
  phone: string;
  email: string;
  mustSetPassword: boolean;
};

/**
 * Resolves a public identifier to the subject, their verified phone and their
 * auth email. Uses the service role because students and teachers are not
 * signed in at this point and therefore have no RLS permissions at all.
 */
async function resolve(
  role: "student" | "teacher",
  identifier: string,
): Promise<Resolved | null> {
  const admin = createAdminClient();

  if (role === "student") {
    const { data: student } = await admin
      .from("students")
      .select("id, auth_user_id")
      .ilike("registration_no", identifier)
      .maybeSingle();

    if (!student?.auth_user_id) return null;

    // The SMS target contact is the only number activation codes go to.
    const { data: contact } = await admin
      .from("student_contacts")
      .select("phone")
      .eq("student_id", student.id)
      .eq("is_sms_target", true)
      .maybeSingle();

    if (!contact) return null;

    const { data: profile } = await admin
      .from("profiles")
      .select("must_set_password, is_active")
      .eq("id", student.auth_user_id)
      .maybeSingle();

    if (!profile?.is_active) return null;

    return {
      subject: { kind: "student", studentId: student.id },
      phone: contact.phone,
      email: syntheticStudentEmail(student.id),
      mustSetPassword: profile.must_set_password,
    };
  }

  const { data: teacher } = await admin
    .from("teachers")
    .select("id, auth_user_id, personal_phone, is_active")
    .ilike("employee_code", identifier)
    .maybeSingle();

  if (!teacher?.auth_user_id || !teacher.is_active) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("must_set_password, is_active")
    .eq("id", teacher.auth_user_id)
    .maybeSingle();

  if (!profile?.is_active) return null;

  return {
    subject: { kind: "teacher", teacherId: teacher.id },
    phone: teacher.personal_phone,
    email: syntheticTeacherEmail(teacher.id),
    mustSetPassword: profile.must_set_password,
  };
}

/** Step 1: identify, then send a code to the phone on record. */
export async function requestCode(
  _prev: ActivationState,
  formData: FormData,
): Promise<ActivationState> {
  const parsed = identifySchema.safeParse({
    role: formData.get("role"),
    identifier: formData.get("identifier"),
    purpose: formData.get("purpose"),
  });

  if (!parsed.success) return { step: "identify", error: GENERIC };

  const { role, identifier, purpose } = parsed.data;
  const resolved = await resolve(role, identifier);

  // Deliberately indistinguishable from a wrong identifier.
  if (!resolved) {
    return { step: "identify", error: GENERIC, role };
  }

  const issued = await issueOtp(resolved.subject, purpose, resolved.phone, identifier);

  if (!issued.ok) {
    if (issued.reason === "rate_limited") {
      return {
        step: "identify",
        error: "Too many code requests. Please wait 30 minutes and try again.",
        role,
      };
    }
    return { step: "identify", error: "Could not send a code just now. Please try again.", role };
  }

  const body =
    purpose === "activation"
      ? `Your School account activation code is ${issued.code}. It expires in ${OTP_TTL_MINUTES} minutes. Do not share it.`
      : `Your School password reset code is ${issued.code}. It expires in ${OTP_TTL_MINUTES} minutes. Do not share it.`;

  const result = await sendSms({ to: resolved.phone, body, kind: "account_otp" });

  return {
    step: "code",
    identifier,
    role,
    maskedPhone: maskPhone(resolved.phone),
    simulated: result.mode === "simulate",
    notice:
      result.mode === "simulate"
        ? "Development simulation: no SMS was actually sent. The code was recorded in the delivery log only."
        : `A ${OTP_TTL_MINUTES}-minute code was sent by SMS.`,
  };
}

const completeSchema = z
  .object({
    role: z.enum(["student", "teacher"]),
    identifier: z.string().trim().min(1).max(64),
    purpose: z.enum(["activation", "password_reset"]),
    code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(200, "That password is too long"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "The two passwords do not match",
    path: ["confirm"],
  });

/** Steps 2 and 3 together: verify the code and set the chosen password. */
export async function verifyAndSetPassword(
  _prev: ActivationState,
  formData: FormData,
): Promise<ActivationState> {
  const parsed = completeSchema.safeParse({
    role: formData.get("role"),
    identifier: formData.get("identifier"),
    purpose: formData.get("purpose"),
    code: formData.get("code"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return {
      step: "code",
      error: parsed.error.issues[0]?.message ?? "Please check the form.",
      identifier: (formData.get("identifier") as string) ?? undefined,
      role: (formData.get("role") as "student" | "teacher") ?? undefined,
    };
  }

  const { role, identifier, purpose, code, password } = parsed.data;

  const resolved = await resolve(role, identifier);
  if (!resolved) return { step: "identify", error: GENERIC };

  const verified = await verifyOtp(resolved.subject, purpose, code, identifier);

  if (!verified.ok) {
    const message =
      verified.reason === "rate_limited"
        ? "Too many attempts. Please wait 30 minutes and try again."
        : verified.reason === "expired"
          ? "That code has expired. Request a new one."
          : verified.reason === "too_many_attempts"
            ? "Too many wrong codes for this request. Request a new code."
            : verified.reason === "no_challenge"
              ? "No active code was found. Request a new one."
              : "That code is not correct.";

    return {
      step: "code",
      error: message,
      identifier,
      role,
      maskedPhone: maskPhone(resolved.phone),
      simulated: smsIsSimulated(),
    };
  }

  const admin = createAdminClient();

  // Find the auth user by the synthetic address the identity convention gives.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const authUser = list?.users.find((u) => u.email === resolved.email);

  if (!authUser) return { step: "identify", error: GENERIC };

  const { error: pwError } = await admin.auth.admin.updateUserById(authUser.id, {
    password,
  });

  if (pwError) {
    return {
      step: "code",
      error: "Could not set that password. Please try again.",
      identifier,
      role,
    };
  }

  // Activation is complete: clear the gate the proxy enforces, and record that
  // the phone on record has now been proven reachable.
  await admin
    .from("profiles")
    .update({ must_set_password: false, activated_at: new Date().toISOString() })
    .eq("id", authUser.id);

  if (resolved.subject.kind === "student") {
    await admin
      .from("student_contacts")
      .update({ verified_at: new Date().toISOString() })
      .eq("student_id", resolved.subject.studentId)
      .eq("is_sms_target", true);
  } else {
    await admin
      .from("teachers")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", resolved.subject.teacherId);
  }

  // Sign them in with the password they just chose, so activation leads
  // straight into their portal rather than back to a login form.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: resolved.email,
    password,
  });

  if (signInError) {
    return {
      step: "done",
      notice: "Your password is set. Please sign in with it now.",
    };
  }

  redirect(role === "student" ? "/student" : "/teacher");
}
