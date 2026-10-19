"use server";

import { randomUUID, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syntheticTeacherEmail } from "@/lib/auth/email-convention";
import { teacherCreateSchema } from "@/lib/validation/teacher";

/**
 * Teacher creation.
 *
 * Same ordering and compensation as student admission: auth identity first,
 * profile, then the atomic school record, undoing the account if that fails.
 * See src/app/authority/students/new/actions.ts for why that order.
 *
 * Assignments arrive as a JSON array in one field rather than as repeated form
 * fields, because the number of rows is dynamic and a JSON payload validated by
 * one schema is easier to reason about than indexed field names.
 */

export type TeacherState = {
  ok?: boolean;
  teacherId?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Set when fewer than three distinct fingers are enrolled on the terminal. */
  fingerWarning?: string;
};

export async function createTeacher(
  _prev: TeacherState,
  formData: FormData,
): Promise<TeacherState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session has expired. Please sign in again." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !["authority_admin", "authority_staff"].includes(profile.role)) {
    return { error: "Only the school office can add a teacher." };
  }

  const raw = Object.fromEntries(formData.entries()) as Record<string, unknown>;

  // Assignments come over as a JSON string from the dynamic rows in the form.
  if (typeof raw.assignments === "string") {
    try {
      raw.assignments = raw.assignments ? JSON.parse(raw.assignments) : [];
    } catch {
      return { error: "The class assignments could not be read. Please re-enter them." };
    }
  }

  const parsed = teacherCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  const admin = createAdminClient();
  const teacherId = randomUUID();
  const email = syntheticTeacherEmail(teacherId);

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
    user_metadata: { provisioned_for: "teacher" },
  });

  if (authError || !created.user) {
    return {
      error: `Could not create the teacher's account: ${authError?.message ?? "unknown error"}`,
    };
  }

  const authUserId = created.user.id;

  async function rollbackAccount() {
    await admin.from("profiles").delete().eq("id", authUserId);
    await admin.auth.admin.deleteUser(authUserId);
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: authUserId,
    role: "teacher",
    full_name: input.full_name,
    must_set_password: true,
    is_active: true,
  });

  if (profileError) {
    await rollbackAccount();
    return { error: `Could not create the teacher's profile: ${profileError.message}` };
  }

  const { error: recordError } = await supabase.rpc("create_teacher_record", {
    p_payload: {
      id: teacherId,
      auth_user_id: authUserId,
      employee_code: input.employee_code,
      full_name: input.full_name,
      full_name_bn: input.full_name_bn || null,
      gender: input.gender,
      blood_group: input.blood_group || null,
      father_name: input.father_name || null,
      mother_name: input.mother_name || null,
      personal_phone: input.personal_phone,
      alternate_phone: input.alternate_phone,
      email: input.email || null,
      nid: input.nid,
      education: input.education || null,
      designation: input.designation || null,
      joined_on: input.joined_on,
      assignments: input.assignments,
      device_id: input.device_id || null,
      device_user_id: input.device_user_id || null,
      enrolled_fingers: input.enrolled_fingers,
      device_notes: input.device_notes || null,
    },
  });

  if (recordError) {
    await rollbackAccount();
    return { error: humaniseDbError(recordError.message) };
  }

  revalidatePath("/authority/teachers");
  revalidatePath("/authority");

  const fingerWarning =
    input.device_user_id && input.enrolled_fingers < 3
      ? `Saved, but only ${input.enrolled_fingers} finger${input.enrolled_fingers === 1 ? "" : "s"} are enrolled on the terminal. The recommended minimum is 3 different fingers. Scanning one finger three times enrolls one finger, not three.`
      : undefined;

  return { ok: true, teacherId, fingerWarning };
}

function humaniseDbError(message: string): string {
  if (message.includes("teachers_employee_code_key")) {
    return "That employee code is already in use.";
  }
  if (message.includes("teacher_assignments_no_overlap")) {
    return "Another teacher already holds one of those class/subject assignments for an overlapping period.";
  }
  if (message.includes("device_users_device_id_device_user_id_key")) {
    return "That device user ID is already mapped to another teacher on this terminal.";
  }
  if (message.includes("device_users_active_teacher_idx")) {
    return "This teacher already has an active mapping on that terminal.";
  }
  if (message.includes("teachers_personal_phone_check")) {
    return "The personal phone number is not a valid Bangladeshi mobile number.";
  }
  if (message.includes("insufficient_privilege") || message.includes("only the school authority")) {
    return "Only the school office can add a teacher.";
  }
  return `Could not save the teacher: ${message}`;
}
