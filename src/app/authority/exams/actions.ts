"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Exam configuration and publishing.
 *
 * The publish action is the consequential one: it freezes a result sheet that
 * parents will receive. It is administrator-only, refuses while any mark is
 * un-entered, and cannot run twice — all enforced in the database, because a
 * guard in a server action can be bypassed by a second code path.
 */

export type ExamState = {
  ok?: boolean;
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string[]>;
  /**
   * Increments on each success. Two identical successes carry the same notice,
   * so a client that clears its fields after one needs something that changes
   * to tell them apart.
   */
  seq?: number;
};

const examSchema = z.object({
  academic_year_id: z.uuid(),
  term_id: z.uuid("Choose a term"),
  name: z.string().trim().min(3, "Give the exam a name").max(120),
  starts_on: z.string().optional(),
  ends_on: z.string().optional(),
});

export async function createExam(
  _prev: ExamState,
  formData: FormData,
): Promise<ExamState> {
  const supabase = await createClient();

  const parsed = examSchema.safeParse({
    academic_year_id: formData.get("academic_year_id"),
    term_id: formData.get("term_id"),
    name: formData.get("name"),
    starts_on: formData.get("starts_on") ?? undefined,
    ends_on: formData.get("ends_on") ?? undefined,
  });

  if (!parsed.success) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  // Default to the school's default grading scale. The exam keeps its own
  // reference so changing the default later cannot re-grade a past exam.
  const { data: scale } = await supabase
    .from("grading_scales")
    .select("id")
    .eq("is_default", true)
    .maybeSingle();

  const { error } = await supabase.from("exams").insert({
    academic_year_id: input.academic_year_id,
    term_id: input.term_id,
    name: input.name,
    status: "draft",
    starts_on: input.starts_on || null,
    ends_on: input.ends_on || null,
    grading_scale_id: scale?.id ?? null,
  });

  if (error) {
    if (error.message.includes("exams_term_id_name_key")) {
      return { error: "An exam with that name already exists for this term." };
    }
    if (error.message.includes("row-level security")) {
      return { error: "Only the school office can create an exam." };
    }
    return { error: `Could not create the exam: ${error.message}` };
  }

  revalidatePath("/authority/exams");
  return { ok: true, notice: `"${input.name}" created as a draft.` };
}

// ---------------------------------------------------------------------------
const subjectSchema = z.object({
  exam_id: z.uuid(),
  class_id: z.uuid("Choose a class"),
  subject_id: z.uuid("Choose a subject"),
  max_marks: z.coerce.number().positive("Maximum marks must be above zero").max(1000),
  pass_marks: z.string().optional(),
  exam_date: z.string().optional(),
});

export async function addExamSubject(
  prev: ExamState,
  formData: FormData,
): Promise<ExamState> {
  const supabase = await createClient();

  const parsed = subjectSchema.safeParse({
    exam_id: formData.get("exam_id"),
    class_id: formData.get("class_id"),
    subject_id: formData.get("subject_id"),
    max_marks: formData.get("max_marks"),
    pass_marks: formData.get("pass_marks") ?? undefined,
    exam_date: formData.get("exam_date") ?? undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the subject details.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;
  const passMarks = input.pass_marks ? Number(input.pass_marks) : null;

  if (passMarks !== null && passMarks > input.max_marks) {
    return { error: "The pass mark cannot be above the maximum." };
  }

  const { error } = await supabase.from("exam_subjects").insert({
    exam_id: input.exam_id,
    class_id: input.class_id,
    subject_id: input.subject_id,
    max_marks: input.max_marks,
    pass_marks: passMarks,
    exam_date: input.exam_date || null,
  });

  if (error) {
    if (error.message.includes("exam_subjects_exam_id_class_id_subject_id_key")) {
      return { error: "That subject is already set for this class in this exam." };
    }
    return { error: `Could not add the subject: ${error.message}` };
  }

  revalidatePath(`/authority/exams/${input.exam_id}`);
  return { ok: true, notice: "Subject added.", seq: (prev.seq ?? 0) + 1 };
}

// ---------------------------------------------------------------------------
const statusSchema = z.object({
  exam_id: z.uuid(),
  status: z.enum(["draft", "scheduled", "marks_open", "marks_closed"]),
});

/**
 * Moves an exam through its lifecycle.
 *
 * `published` is deliberately absent: publishing goes through publishResults,
 * which computes the sheets. Allowing the status to be set to published
 * directly would mark an exam as published with no result rows behind it.
 */
export async function setExamStatus(
  _prev: ExamState,
  formData: FormData,
): Promise<ExamState> {
  const supabase = await createClient();

  const parsed = statusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "That status is not valid." };

  const { error } = await supabase
    .from("exams")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.exam_id);

  if (error) return { error: `Could not change the status: ${error.message}` };

  revalidatePath(`/authority/exams/${parsed.data.exam_id}`);
  revalidatePath("/authority/exams");

  const words: Record<string, string> = {
    draft: "back to draft. Teachers cannot enter marks.",
    scheduled: "scheduled. The routine is visible to students once published below.",
    marks_open: "open for mark entry. Assigned teachers can now submit marks.",
    marks_closed: "closed for mark entry. Teachers can no longer change marks.",
  };

  return { ok: true, notice: `Exam ${words[parsed.data.status]}` };
}

// ---------------------------------------------------------------------------
export async function publishExamRoutine(
  _prev: ExamState,
  formData: FormData,
): Promise<ExamState> {
  const supabase = await createClient();

  const examId = String(formData.get("exam_id") ?? "");
  if (!examId) return { error: "No exam was given." };

  // Publishing the ROUTINE is separate from publishing RESULTS: students see
  // the schedule long before any marks exist.
  const { error } = await supabase
    .from("exams")
    .update({ routine_published_at: new Date().toISOString() })
    .eq("id", examId);

  if (error) return { error: `Could not publish the routine: ${error.message}` };

  revalidatePath(`/authority/exams/${examId}`);
  return { ok: true, notice: "The exam routine is now visible to students." };
}

// ---------------------------------------------------------------------------
export async function publishResults(
  _prev: ExamState,
  formData: FormData,
): Promise<ExamState> {
  const supabase = await createClient();

  const examId = String(formData.get("exam_id") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!examId) return { error: "No exam was given." };

  // Typed confirmation, because publishing cannot be undone: the sheets become
  // visible to every student and parent at once.
  if (confirm.trim().toUpperCase() !== "PUBLISH") {
    return { error: 'Type PUBLISH to confirm. Publishing cannot be undone.' };
  }

  const { data, error } = await supabase.rpc("publish_results", { p_exam_id: examId });

  if (error) {
    if (error.message.includes("un-entered")) {
      return {
        error:
          error.message.replace(/^.*?\s(\d+ mark)/, "$1") +
          " Chase the outstanding subjects in the table below first.",
      };
    }
    if (error.message.includes("already published")) {
      return { error: "Results for this exam have already been published." };
    }
    if (error.message.includes("only a school administrator")) {
      return { error: "Only a school administrator can publish results." };
    }
    if (error.message.includes("no grading scale")) {
      return { error: "No grading scale is configured, so results cannot be graded." };
    }
    return { error: `Could not publish: ${error.message}` };
  }

  const result = data as { published: number; scale: string; pass_rule: string };

  revalidatePath(`/authority/exams/${examId}`);
  revalidatePath("/authority/exams");

  return {
    ok: true,
    notice:
      `${result.published} result${result.published === 1 ? "" : "s"} published ` +
      `using the "${result.scale}" scale. Students can see their sheets now. ` +
      `No SMS has been sent: queue the messages under Notifications, where you ` +
      `can see what they would cost. SMS is a simulation until a provider is ` +
      `connected, so nothing reaches a phone either way.`,
  };
}
