"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupStudentIdentity, lookupTeacherIdentity } from "@/lib/auth/identity";

/**
 * Sign-in actions, one per portal.
 *
 * Every failure path returns the SAME message. A login form that says
 * "no such registration number" for one input and "wrong password" for another
 * tells an attacker which registration numbers exist, and registration numbers
 * are printed on ID cards. The distinction is logged server-side instead.
 */

const GENERIC_FAILURE = "Those sign-in details did not match. Please try again.";

export type LoginState = { error?: string };

/** Attempts per identifier, per window, before sign-in is refused. */
const RATE_LIMIT = { attempts: 8, windowMinutes: 15 };

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? h.get("x-real-ip");
}

/**
 * Records the attempt and reports whether the identifier is currently locked.
 * Written with the service role: auth_attempts is readable and writable by
 * nobody else, because it is the rate-limit state itself.
 */
async function checkAndRecordAttempt(
  identifier: string,
  kind: "login" | "otp_request" | "otp_verify",
): Promise<{ limited: boolean; record: (succeeded: boolean) => Promise<void> }> {
  const admin = createAdminClient();
  const ip = await clientIp();
  const since = new Date(Date.now() - RATE_LIMIT.windowMinutes * 60_000).toISOString();

  const { count } = await admin
    .from("auth_attempts")
    .select("id", { count: "exact", head: true })
    .eq("identifier", identifier.toLowerCase())
    .eq("kind", kind)
    .eq("succeeded", false)
    .gte("attempted_at", since);

  const limited = (count ?? 0) >= RATE_LIMIT.attempts;

  return {
    limited,
    record: async (succeeded: boolean) => {
      await admin.from("auth_attempts").insert({
        identifier: identifier.toLowerCase(),
        kind,
        succeeded,
        ip_address: ip,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Authority: ordinary email + password
// ---------------------------------------------------------------------------
const authoritySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function signInAuthority(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = authoritySchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC_FAILURE };

  const gate = await checkAndRecordAttempt(parsed.data.email, "login");
  if (gate.limited) {
    return { error: "Too many attempts. Please wait 15 minutes and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  await gate.record(!error);
  if (error) return { error: GENERIC_FAILURE };

  redirect("/authority");
}

// ---------------------------------------------------------------------------
// Student: registration number + password
// ---------------------------------------------------------------------------
const studentSchema = z.object({
  registrationNo: z.string().min(1).max(64),
  password: z.string().min(1),
});

export async function signInStudent(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = studentSchema.safeParse({
    registrationNo: formData.get("registrationNo"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC_FAILURE };

  const gate = await checkAndRecordAttempt(parsed.data.registrationNo, "login");
  if (gate.limited) {
    return { error: "Too many attempts. Please wait 15 minutes and try again." };
  }

  const identity = await lookupStudentIdentity(parsed.data.registrationNo);
  if (!identity.found) {
    await gate.record(false);
    // Same message as a wrong password, deliberately.
    return { error: GENERIC_FAILURE };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: identity.email,
    password: parsed.data.password,
  });

  await gate.record(!error);
  if (error) return { error: GENERIC_FAILURE };

  redirect(identity.mustSetPassword ? "/activate" : "/student");
}

// ---------------------------------------------------------------------------
// Teacher: employee code + password
// ---------------------------------------------------------------------------
const teacherSchema = z.object({
  employeeCode: z.string().min(1).max(64),
  password: z.string().min(1),
});

export async function signInTeacher(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = teacherSchema.safeParse({
    employeeCode: formData.get("employeeCode"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC_FAILURE };

  const gate = await checkAndRecordAttempt(parsed.data.employeeCode, "login");
  if (gate.limited) {
    return { error: "Too many attempts. Please wait 15 minutes and try again." };
  }

  const identity = await lookupTeacherIdentity(parsed.data.employeeCode);
  if (!identity.found) {
    await gate.record(false);
    return { error: GENERIC_FAILURE };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: identity.email,
    password: parsed.data.password,
  });

  await gate.record(!error);
  if (error) return { error: GENERIC_FAILURE };

  redirect(identity.mustSetPassword ? "/activate" : "/teacher");
}

// ---------------------------------------------------------------------------
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
