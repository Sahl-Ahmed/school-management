"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Attendance submission.
 *
 * All the real work is in `submit_attendance` (migration 0025), which writes
 * the session and every student row in one transaction and sets submitted_at
 * last. That ordering is what guarantees a lesson is never left half-submitted
 * — which would read as "absent" for the students whose rows never arrived.
 *
 * This action's job is to shape the form data, and to require a reason when the
 * lesson has already been submitted. A correction without a stated reason is
 * refused by the database too; asking here produces a better message.
 */

export type AttendanceState = {
  ok?: boolean;
  marked?: number;
  correction?: boolean;
  error?: string;
};

const STATUSES = ["present", "absent", "late", "excused"] as const;

const entrySchema = z.object({
  student_id: z.uuid(),
  status: z.enum(STATUSES),
  remark: z.string().trim().max(200).optional(),
});

const schema = z.object({
  routine_period_id: z.uuid(),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  reason: z.string().trim().max(500).optional().default(""),
  roster_size: z.coerce.number().int().min(0).default(0),
  entries: z.array(entrySchema).max(500),
});

export async function submitAttendance(
  _prev: AttendanceState,
  formData: FormData,
): Promise<AttendanceState> {
  const supabase = await createClient();

  /*
   * The marks arrive as one JSON field rather than as individual radio inputs.
   *
   * React 19 resets a form once a Server Action completes, which clears every
   * radio in the DOM. Reading per-radio fields meant that after a rejected
   * submission the teacher's marks were gone and a retry submitted nothing —
   * so the roster now serialises its own state and this reads that.
   */
  const rawEntries = formData.get("entries");
  let parsedEntries: unknown = [];

  if (typeof rawEntries === "string" && rawEntries.length > 0) {
    try {
      parsedEntries = JSON.parse(rawEntries);
    } catch {
      return { error: "The marks could not be read. Please re-enter them." };
    }
  }

  const parsed = schema.safeParse({
    routine_period_id: formData.get("routine_period_id"),
    session_date: formData.get("session_date"),
    // `?? undefined` is load-bearing: FormData.get returns NULL for a field
    // that was not rendered, and Zod's .optional() accepts undefined but
    // REJECTS null. The reason field only exists for a correction, so without
    // this the whole parse failed on every first submission — and the error it
    // produced pointed at the lesson and the marks, which were both fine.
    reason: formData.get("reason") ?? undefined,
    roster_size: formData.get("roster_size") ?? undefined,
    entries: parsedEntries,
  });

  if (!parsed.success) {
    return { error: "Please choose a valid lesson and mark every student." };
  }

  const entries = parsed.data.entries;
  const expected = parsed.data.roster_size;

  if (entries.length === 0) {
    return { error: "Mark at least one student before submitting." };
  }

  // An unmarked student is caught here rather than producing a quietly
  // incomplete submission that would read as absence for the missing rows.
  if (expected > 0 && entries.length < expected) {
    return {
      error: `${expected - entries.length} of ${expected} students are unmarked. Mark everyone, or leave the lesson unsubmitted — an unsubmitted lesson is not counted as absence.`,
    };
  }

  const { data, error } = await supabase.rpc("submit_attendance", {
    p_routine_period_id: parsed.data.routine_period_id,
    p_session_date: parsed.data.session_date,
    p_entries: entries,
    p_reason: parsed.data.reason || null,
  });

  if (error) {
    return { error: humanise(error.message) };
  }

  const result = data as { session_id: string; marked: number; correction: boolean };

  revalidatePath("/teacher/attendance");
  revalidatePath("/teacher");

  return { ok: true, marked: result.marked, correction: result.correction };
}

function humanise(message: string): string {
  if (message.includes("requires a reason")) {
    return "This lesson's attendance was already submitted. Give a reason for the correction.";
  }
  if (message.includes("not the teacher scheduled")) {
    return "You are not the teacher scheduled for this period.";
  }
  if (message.includes("is not enrolled in this section")) {
    return "One of those students is not enrolled in this class.";
  }
  if (message.includes("school holiday")) {
    return "That date is a school holiday, so there is no lesson to record.";
  }
  if (message.includes("was cancelled")) {
    return "This period was cancelled on that date, so there is no lesson to record.";
  }
  if (message.includes("is not a") && message.includes("for this period")) {
    return "That date is not a day this period runs.";
  }
  if (message.includes("effective dates")) {
    return "That date falls outside the dates this period applies to.";
  }
  if (message.includes("insufficient_privilege") || message.includes("row-level security")) {
    return "You do not have permission to submit attendance for this lesson.";
  }
  return `Could not submit attendance: ${message}`;
}
