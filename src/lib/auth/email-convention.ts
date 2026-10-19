/**
 * How a public identifier becomes a Supabase Auth email.
 *
 * Supabase Auth keys accounts by email, but students sign in with a
 * registration number and teachers with an employee code. Accounts are
 * therefore created with a synthetic, non-deliverable address on the
 * `.invalid` TLD, which RFC 2606 reserves so it can never resolve. No mail is
 * ever sent there; the address exists only because Auth needs a unique key.
 *
 * The address derives from the row's uuid rather than from the registration
 * number, so correcting a mistyped registration number does not require
 * touching the auth identity, and the address itself reveals nothing.
 *
 * This module is deliberately free of server-only imports: account
 * provisioning, the login path and the remote verification tests must all
 * agree on one definition. Duplicating this convention in a test would let the
 * test keep passing after the real mapping changed.
 */

export const STUDENT_EMAIL_DOMAIN = "students.school.invalid";
export const TEACHER_EMAIL_DOMAIN = "teachers.school.invalid";

export function syntheticStudentEmail(studentId: string): string {
  return `s-${studentId}@${STUDENT_EMAIL_DOMAIN}`;
}

export function syntheticTeacherEmail(teacherId: string): string {
  return `t-${teacherId}@${TEACHER_EMAIL_DOMAIN}`;
}
