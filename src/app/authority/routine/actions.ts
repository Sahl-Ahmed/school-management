"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Routine editing.
 *
 * Clash prevention is enforced by exclusion constraints in the database
 * (migration 0006): no two overlapping periods for the same section on the same
 * weekday, and none for the same teacher. Those constraints are the guarantee;
 * this action's job is to turn their raw violation messages into something a
 * school office can act on, and to tell the user WHICH existing period clashed.
 *
 * Deliberately not validated here instead of there: a check in application code
 * would race. Two offices adding Monday 09:00 at the same moment both pass a
 * "is this slot free?" query and both insert. The exclusion constraint cannot be
 * raced.
 */

export type RoutineState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Set when a clash was detected, describing the conflicting period. */
  clash?: string;
};

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

const periodSchema = z
  .object({
    academic_year_id: z.uuid(),
    section_id: z.uuid("Select a class and section"),
    subject_id: z.uuid("Select a subject"),
    teacher_id: z.uuid("Select a teacher"),
    weekday: z.coerce.number().int().min(0).max(6),
    period_no: z.coerce
      .number({ message: "Period number is required" })
      .int()
      .positive("Period number must be greater than zero")
      .max(20),
    starts_at: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
    ends_at: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM"),
    effective_from: z.string().min(1, "An effective date is required"),
  })
  .refine((d) => d.ends_at > d.starts_at, {
    message: "The end time must be after the start time",
    path: ["ends_at"],
  });

export async function addRoutinePeriod(
  _prev: RoutineState,
  formData: FormData,
): Promise<RoutineState> {
  const supabase = await createClient();

  const parsed = periodSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  // The class is derived from the section rather than taken from the form, so a
  // period cannot be filed under a class the section does not belong to.
  const { data: section } = await supabase
    .from("sections")
    .select("class_id")
    .eq("id", input.section_id)
    .maybeSingle();

  if (!section) return { error: "That class and section no longer exists." };

  const { error } = await supabase.from("routine_periods").insert({
    academic_year_id: input.academic_year_id,
    class_id: section.class_id,
    section_id: input.section_id,
    subject_id: input.subject_id,
    teacher_id: input.teacher_id,
    weekday: input.weekday,
    period_no: input.period_no,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    effective_from: input.effective_from,
  });

  if (error) {
    // Name the actual conflicting period, since "that clashes" without saying
    // with what leaves the office guessing.
    if (error.message.includes("routine_periods_no_teacher_clash")) {
      const clash = await describeTeacherClash(input);
      return {
        error: "That teacher is already teaching at that time.",
        clash,
      };
    }
    if (error.message.includes("routine_periods_no_section_clash")) {
      const clash = await describeSectionClash(input);
      return {
        error: "That class already has a lesson at that time.",
        clash,
      };
    }
    if (error.message.includes("routine_periods_time_order")) {
      return { error: "The end time must be after the start time." };
    }
    if (error.message.includes("row-level security")) {
      return { error: "Only the school office can edit the routine." };
    }
    return { error: `Could not save the period: ${error.message}` };
  }

  revalidatePath("/authority/routine");
  return { ok: true };
}

/** Finds the teacher's existing period that overlaps the attempted slot. */
async function describeTeacherClash(input: {
  teacher_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
}): Promise<string | undefined> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("routine_periods")
    .select("starts_at, ends_at, classes(name), sections(name), subjects(name)")
    .eq("teacher_id", input.teacher_id)
    .eq("weekday", input.weekday)
    .lt("starts_at", input.ends_at)
    .gt("ends_at", input.starts_at)
    .limit(1);

  const row = data?.[0];
  if (!row) return undefined;

  const cls = asOne(row.classes)?.name ?? "a class";
  const sec = asOne(row.sections)?.name;
  const subj = asOne(row.subjects)?.name ?? "a subject";

  return `Already teaching ${subj} to ${cls}${sec ? ` section ${sec}` : ""} on ${WEEKDAY_NAMES[input.weekday]} from ${trimTime(row.starts_at)} to ${trimTime(row.ends_at)}.`;
}

/** Finds the section's existing period that overlaps the attempted slot. */
async function describeSectionClash(input: {
  section_id: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
}): Promise<string | undefined> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("routine_periods")
    .select("starts_at, ends_at, subjects(name), teachers(full_name)")
    .eq("section_id", input.section_id)
    .eq("weekday", input.weekday)
    .lt("starts_at", input.ends_at)
    .gt("ends_at", input.starts_at)
    .limit(1);

  const row = data?.[0];
  if (!row) return undefined;

  const subj = asOne(row.subjects)?.name ?? "a subject";
  const teacher = asOne(row.teachers)?.full_name ?? "a teacher";

  return `${subj} with ${teacher} already occupies ${WEEKDAY_NAMES[input.weekday]} from ${trimTime(row.starts_at)} to ${trimTime(row.ends_at)}.`;
}

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** 09:45:00 -> 09:45 */
function trimTime(t: string): string {
  return t.slice(0, 5);
}

// ---------------------------------------------------------------------------

/**
 * Closes a period rather than deleting it.
 *
 * Setting effective_to preserves who taught the earlier part of the term, which
 * is the whole point of effective dating. Deleting the row would rewrite
 * history: past teaching_sessions reference it, and a published result sheet's
 * attendance window could silently change.
 */
export async function endRoutinePeriod(
  _prev: RoutineState,
  formData: FormData,
): Promise<RoutineState> {
  const supabase = await createClient();

  const parsed = z
    .object({
      id: z.uuid(),
      effective_to: z.string().min(1, "Choose the last date this applies"),
    })
    .safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return { error: "Choose the last date this period applies." };
  }

  const { error } = await supabase
    .from("routine_periods")
    .update({ effective_to: parsed.data.effective_to })
    .eq("id", parsed.data.id);

  if (error) {
    if (error.message.includes("routine_periods_date_order")) {
      return { error: "The end date cannot be before the period started." };
    }
    return { error: `Could not close the period: ${error.message}` };
  }

  revalidatePath("/authority/routine");
  return { ok: true };
}
