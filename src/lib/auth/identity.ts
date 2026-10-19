import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export { normaliseBdPhone } from "@/lib/phone";

// The email convention is shared with account provisioning and the remote
// verification tests, so all three cannot drift apart.
import {
  syntheticStudentEmail,
  syntheticTeacherEmail,
} from "@/lib/auth/email-convention";

export {
  syntheticStudentEmail,
  syntheticTeacherEmail,
  STUDENT_EMAIL_DOMAIN,
  TEACHER_EMAIL_DOMAIN,
} from "@/lib/auth/email-convention";

/**
 * Mapping a public identifier to a Supabase Auth identity.
 *
 * Students sign in with a registration number, teachers with an employee code.
 * Neither is an email address, and Supabase Auth keys accounts by email, so a
 * lookup sits in between.
 *
 * Two constraints shape how this is done:
 *
 *   * A guardian phone number cannot be the key, because siblings share one.
 *     The registration number is the key, and it is unique and permanent.
 *
 *   * The lookup must not become an enumeration oracle. These functions run
 *     server-side only and the login action returns one indistinguishable
 *     error for "no such registration number" and "wrong password", so an
 *     attacker cannot use the login form to discover which numbers exist.
 *
 * Accounts are created with a synthetic, non-deliverable address on the
 * `.invalid` TLD, which RFC 2606 reserves precisely so it can never resolve.
 * No mail is ever sent to it; it exists only because Auth needs a unique key.
 */

export type IdentityLookup =
  | { found: true; email: string; subjectId: string; mustSetPassword: boolean }
  | { found: false };

/**
 * Resolves a registration number to the student's auth email.
 * Returns `{ found: false }` for an unknown number AND for a student who has
 * no auth identity yet; the caller must not distinguish them to the user.
 */
export async function lookupStudentIdentity(
  registrationNo: string,
): Promise<IdentityLookup> {
  const admin = createAdminClient();

  const { data: student } = await admin
    .from("students")
    .select("id, auth_user_id")
    // Case-insensitive, matching the unique index on lower(registration_no).
    .ilike("registration_no", registrationNo.trim())
    .maybeSingle();

  if (!student?.auth_user_id) return { found: false };

  const { data: profile } = await admin
    .from("profiles")
    .select("must_set_password, is_active")
    .eq("id", student.auth_user_id)
    .maybeSingle();

  if (!profile?.is_active) return { found: false };

  return {
    found: true,
    email: syntheticStudentEmail(student.id),
    subjectId: student.id,
    mustSetPassword: profile.must_set_password,
  };
}

/** Resolves a teacher's employee code to their auth email. */
export async function lookupTeacherIdentity(
  employeeCode: string,
): Promise<IdentityLookup> {
  const admin = createAdminClient();

  const { data: teacher } = await admin
    .from("teachers")
    .select("id, auth_user_id, is_active")
    .ilike("employee_code", employeeCode.trim())
    .maybeSingle();

  if (!teacher?.auth_user_id || !teacher.is_active) return { found: false };

  const { data: profile } = await admin
    .from("profiles")
    .select("must_set_password, is_active")
    .eq("id", teacher.auth_user_id)
    .maybeSingle();

  if (!profile?.is_active) return { found: false };

  return {
    found: true,
    email: syntheticTeacherEmail(teacher.id),
    subjectId: teacher.id,
    mustSetPassword: profile.must_set_password,
  };
}
