"use server";

import { randomUUID, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syntheticStudentEmail } from "@/lib/auth/email-convention";
import {
  studentAdmissionSchema,
  studentPhotoSchema,
  PHOTO_MAX_BYTES,
} from "@/lib/validation/student";

/**
 * Student admission.
 *
 * The sequence matters and is deliberate:
 *
 *   1. Generate the student uuid up front, because the synthetic auth email is
 *      derived from it.
 *   2. Create the auth user. This is the step most likely to fail for an
 *      external reason, so it happens before any school data is written.
 *   3. Insert the profile row.
 *   4. Call create_student_record, which writes all four school tables in one
 *      transaction.
 *   5. If step 4 fails, delete the profile and the auth user. Without that
 *      compensation a failed admission would leave an orphan account holding
 *      the synthetic email, and retrying with the same details would then fail
 *      on a duplicate email rather than telling the user what was wrong.
 *   6. Upload the photo LAST, through the authority's own session rather than
 *      the service role, so the storage policy is actually exercised. A photo
 *      failure does not roll back the admission: the student exists and the
 *      photo can be added afterwards, which is better than discarding a
 *      completed form.
 *
 * The account is created with must_set_password = true, so the student cannot
 * use it until they complete OTP activation and choose their own password. The
 * password set here is random, never shown to anyone, and never reused.
 */

export type AdmissionState = {
  ok?: boolean;
  studentId?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Set when the student was admitted but the photo did not store. */
  warning?: string;
};

export async function admitStudent(
  _prev: AdmissionState,
  formData: FormData,
): Promise<AdmissionState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  // Authorisation is re-checked in the database by create_student_record, which
  // calls app.is_authority() itself. This check only produces a better message.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !["authority_admin", "authority_staff"].includes(profile.role)) {
    return { error: "Only the school office can admit a student." };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = studentAdmissionSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  // The photo is optional at admission; a student can be admitted today and
  // photographed tomorrow.
  const photoEntry = formData.get("photo");
  let photo: File | null = null;

  if (photoEntry instanceof File && photoEntry.size > 0) {
    const photoCheck = studentPhotoSchema.safeParse(photoEntry);
    if (!photoCheck.success) {
      return {
        error: photoCheck.error.issues[0]?.message ?? "That photo could not be used.",
        fieldErrors: { photo: photoCheck.error.issues.map((i) => i.message) },
      };
    }
    photo = photoCheck.data;
  }

  const admin = createAdminClient();
  const studentId = randomUUID();
  const email = syntheticStudentEmail(studentId);

  // --- 2. auth identity ----------------------------------------------------
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    // Random and discarded. The student sets their own during activation.
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
    user_metadata: { provisioned_for: "student" },
  });

  if (authError || !created.user) {
    return {
      error: `Could not create the student's account: ${authError?.message ?? "unknown error"}`,
    };
  }

  const authUserId = created.user.id;

  /** Undoes steps 2 and 3 when a later step fails. */
  async function rollbackAccount() {
    await admin.from("profiles").delete().eq("id", authUserId);
    await admin.auth.admin.deleteUser(authUserId);
  }

  // --- 3. profile ----------------------------------------------------------
  const { error: profileError } = await admin.from("profiles").insert({
    id: authUserId,
    role: "student",
    full_name: input.full_name,
    // Activation is required before this account can be used.
    must_set_password: true,
    is_active: true,
  });

  if (profileError) {
    await rollbackAccount();
    return { error: `Could not create the student's profile: ${profileError.message}` };
  }

  // --- 4. school record, atomically ---------------------------------------
  const { error: recordError } = await supabase.rpc("create_student_record", {
    p_payload: {
      id: studentId,
      auth_user_id: authUserId,
      registration_no: input.registration_no,
      full_name: input.full_name,
      full_name_bn: input.full_name_bn || null,
      gender: input.gender,
      date_of_birth: input.date_of_birth,
      blood_group: input.blood_group || null,
      father_name: input.father_name,
      mother_name: input.mother_name,
      guardian_phone: input.guardian_phone,
      contact_holder_name: input.contact_holder_name || null,
      academic_year_id: input.academic_year_id,
      section_id: input.section_id,
      roll_no: input.roll_no,
      father_nid: input.father_nid,
      mother_nid: input.mother_nid,
      birth_certificate_no: input.birth_certificate_no,
      admitted_on: input.admitted_on,
    },
  });

  if (recordError) {
    await rollbackAccount();
    return { error: humaniseDbError(recordError.message) };
  }

  // --- 6. photo, through the authority's own session -----------------------
  let warning: string | undefined;

  if (photo) {
    // Server-side size re-check. The browser compressed it, but the browser is
    // not trusted; the bucket enforces the same limit a third time.
    if (photo.size > PHOTO_MAX_BYTES) {
      warning = `The student was admitted, but the photo was ${Math.round(photo.size / 1024)} KB, over the ${Math.round(PHOTO_MAX_BYTES / 1024)} KB limit, so it was not stored.`;
    } else {
      const extension = photo.type === "image/webp" ? "webp" : photo.type === "image/png" ? "png" : "jpg";
      // The first path segment is the authorisation key in the storage policy.
      const objectPath = `${studentId}/passport.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("student-photos")
        .upload(objectPath, photo, { contentType: photo.type, upsert: true });

      if (uploadError) {
        warning = `The student was admitted, but the photo could not be stored: ${uploadError.message}`;
      } else {
        const { error: linkError } = await supabase
          .from("students")
          .update({ photo_path: objectPath, photo_bytes: photo.size })
          .eq("id", studentId);

        if (linkError) {
          warning = `The student was admitted and the photo stored, but linking it failed: ${linkError.message}`;
        }
      }
    }
  }

  revalidatePath("/authority/students");
  revalidatePath("/authority");

  return { ok: true, studentId, warning };
}

/** Turns a constraint violation into something an office user can act on. */
function humaniseDbError(message: string): string {
  if (message.includes("students_registration_no_lower_idx") ||
      message.includes("students_registration_no_key")) {
    return "That registration number is already in use. Registration numbers must be unique.";
  }
  if (message.includes("student_enrollments_academic_year_id_section_id_roll_no_key")) {
    return "That roll number is already taken in this class and section for this year.";
  }
  if (message.includes("student_private_ids_at_least_one_nid")) {
    return "Enter at least one parent's NID.";
  }
  if (message.includes("student_contacts_phone_check")) {
    return "The guardian phone number is not a valid Bangladeshi mobile number.";
  }
  if (message.includes("insufficient_privilege") ||
      message.includes("only the school authority")) {
    return "Only the school office can admit a student.";
  }
  return `Could not save the admission: ${message}`;
}
