"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Teacher mark entry.
 *
 * The RPC (migration 0030) does the work: it checks the teacher is assigned to
 * the subject, that entry is open, and writes every mark plus the submission
 * record in one transaction — recording the submission LAST, so a failure
 * leaves the subject un-submitted rather than submitted-but-incomplete, which
 * the authority would read as ready to publish.
 *
 * Marks arrive as one JSON field for the same reason the attendance roster and
 * the payment form do: React 19 resets a form after a Server Action, so
 * per-row inputs cannot be relied on for a retry.
 */

export type MarksState = {
  ok?: boolean;
  error?: string;
  notice?: string;
  marked?: number;
  correction?: boolean;
};

const entrySchema = z.object({
  student_id: z.uuid(),
  marks: z.union([z.coerce.number().min(0).max(1000), z.null()]),
  absent: z.boolean(),
});

const schema = z.object({
  exam_subject_id: z.uuid(),
  section_id: z.uuid(),
  reason: z.string().trim().max(500).optional(),
  roster_size: z.coerce.number().int().min(0).default(0),
  entries: z.array(entrySchema).min(1, "Enter a mark for at least one student"),
});

export async function submitMarks(
  _prev: MarksState,
  formData: FormData,
): Promise<MarksState> {
  const supabase = await createClient();

  const raw = formData.get("entries");
  let entries: unknown = [];

  if (typeof raw === "string" && raw.length > 0) {
    try {
      entries = JSON.parse(raw);
    } catch {
      return { error: "The marks could not be read. Please re-enter them." };
    }
  }

  const parsed = schema.safeParse({
    exam_subject_id: formData.get("exam_subject_id"),
    section_id: formData.get("section_id"),
    // FormData.get returns null for an absent field and Zod's .optional()
    // rejects null, so these are normalised.
    reason: formData.get("reason") ?? undefined,
    roster_size: formData.get("roster_size") ?? undefined,
    entries,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the marks." };
  }

  const input = parsed.data;

  // An incomplete subject is refused here rather than producing a submission
  // the authority would treat as finished.
  if (input.roster_size > 0 && input.entries.length < input.roster_size) {
    const missing = input.roster_size - input.entries.length;
    return {
      error: `${missing} of ${input.roster_size} students have no mark. Enter a score or mark them absent — a blank is not the same as a zero.`,
    };
  }

  const { data, error } = await supabase.rpc("submit_marks", {
    p_exam_subject_id: input.exam_subject_id,
    p_section_id: input.section_id,
    p_entries: input.entries.map((e) => ({
      student_id: e.student_id,
      marks: e.absent ? null : e.marks,
      absent: e.absent,
    })),
    p_reason: input.reason || null,
  });

  if (error) return { error: humanise(error.message) };

  const result = data as { marked: number; correction: boolean };

  revalidatePath("/teacher/marks");
  revalidatePath("/teacher");

  return {
    ok: true,
    marked: result.marked,
    correction: result.correction,
    notice: result.correction
      ? `Marks corrected for ${result.marked} students. The change is in the audit log.`
      : `Marks submitted for ${result.marked} students. They stay private until the school publishes the results.`,
  };
}

function humanise(message: string): string {
  if (message.includes("not assigned to teach")) {
    return "You are not assigned to teach that subject to that class.";
  }
  if (message.includes("mark entry is not open")) {
    return "Mark entry is not open for this exam. The school office controls when it opens.";
  }
  if (message.includes("requires a reason")) {
    return "These marks were already submitted. Give a reason for the correction.";
  }
  if (message.includes("exceeds max_marks")) {
    return "One mark is above the maximum for this subject.";
  }
  if (message.includes("needs a score or an absence")) {
    return "Every student needs a score or an absence mark.";
  }
  if (message.includes("absent cannot also have a score")) {
    return "A student marked absent cannot also have a score.";
  }
  if (message.includes("not enrolled in this section")) {
    return "One of those students is not enrolled in this class.";
  }
  if (message.includes("row-level security") || message.includes("insufficient_privilege")) {
    return "You do not have permission to enter these marks.";
  }
  return `Could not submit marks: ${message}`;
}

// ---------------------------------------------------------------------------
/**
 * Sends an extra class test's result to guardians.
 *
 * The duplicate guard is in the database: result_sent_at is checked and set in
 * the same transaction, so two concurrent clicks cannot both send. The SMS
 * itself is a DEVELOPMENT SIMULATION — nothing reaches any phone until a
 * provider is connected in phase 7, and the message below says so.
 */
export async function sendClassTestResult(
  _prev: MarksState,
  formData: FormData,
): Promise<MarksState> {
  const supabase = await createClient();

  const testId = String(formData.get("class_test_id") ?? "");
  if (!testId) return { error: "No class test was given." };

  const { data, error } = await supabase.rpc("send_class_test_result", {
    p_class_test_id: testId,
  });

  if (error) {
    if (error.message.includes("already sent")) {
      return { error: "Results for this test have already been sent. They are not sent twice." };
    }
    if (error.message.includes("enter marks before")) {
      return { error: "Enter the marks before sending results." };
    }
    if (error.message.includes("belongs to another teacher")) {
      return { error: "That class test belongs to another teacher." };
    }
    return { error: `Could not send: ${error.message}` };
  }

  const result = data as { students: number };

  revalidatePath("/teacher/class-tests");

  return {
    ok: true,
    notice:
      `Marked as sent for ${result.students} students. ` +
      `DEVELOPMENT SIMULATION — no SMS provider is connected, so no message ` +
      `reached any phone. Real delivery arrives in phase 7.`,
  };
}
