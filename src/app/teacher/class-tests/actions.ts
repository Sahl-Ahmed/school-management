"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Teacher-created extra class tests.
 *
 * These are the teacher's own, not the school's: a teacher creates one, marks
 * it, and may send the result to guardians. Row-level security ties every row
 * to the calling teacher and to a section/subject they actually teach on the
 * test date, so nothing here can reach another teacher's class.
 */

export type ClassTestState = {
  ok?: boolean;
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string[]>;
};

const createSchema = z.object({
  academic_year_id: z.uuid(),
  assignment: z.string().min(1, "Choose a class and subject"),
  name: z.string().trim().min(2, "Give the test a name").max(120),
  max_marks: z.coerce.number().positive("Maximum marks must be above zero").max(1000),
  test_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the test date"),
});

export async function createClassTest(
  _prev: ClassTestState,
  formData: FormData,
): Promise<ClassTestState> {
  const supabase = await createClient();

  const parsed = createSchema.safeParse({
    academic_year_id: formData.get("academic_year_id"),
    assignment: formData.get("assignment"),
    name: formData.get("name"),
    max_marks: formData.get("max_marks"),
    test_date: formData.get("test_date"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the test details.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  // The picker offers only the teacher's own assignments, so class, section and
  // subject travel together as one value rather than as three fields a crafted
  // request could mix and match.
  const [classId, sectionId, subjectId] = input.assignment.split(":");
  if (!classId || !sectionId || !subjectId) {
    return { error: "That class and subject could not be read. Choose it again." };
  }

  const { data: teacher } = await supabase.from("teachers").select("id").maybeSingle();
  if (!teacher) {
    return { error: "Your account is not linked to a teacher record." };
  }

  const { error } = await supabase.from("class_tests").insert({
    academic_year_id: input.academic_year_id,
    class_id: classId,
    section_id: sectionId,
    subject_id: subjectId,
    teacher_id: teacher.id,
    name: input.name,
    max_marks: input.max_marks,
    test_date: input.test_date,
    status: "draft",
  });

  if (error) {
    if (error.message.includes("row-level security")) {
      return {
        error:
          "You were not teaching that subject to that class on the test date, " +
          "so the test cannot be created for it.",
      };
    }
    return { error: `Could not create the test: ${error.message}` };
  }

  revalidatePath("/teacher/class-tests");
  return { ok: true, notice: `"${input.name}" created. Enter the marks below.` };
}

// ---------------------------------------------------------------------------
const markEntrySchema = z.object({
  student_id: z.uuid(),
  marks: z.union([z.coerce.number().min(0).max(1000), z.null()]),
  absent: z.boolean(),
});

const marksSchema = z.object({
  class_test_id: z.uuid(),
  max_marks: z.coerce.number().positive(),
  entries: z.array(markEntrySchema).min(1, "Enter a mark for at least one student"),
});

export async function saveClassTestMarks(
  _prev: ClassTestState,
  formData: FormData,
): Promise<ClassTestState> {
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

  const parsed = marksSchema.safeParse({
    class_test_id: formData.get("class_test_id"),
    max_marks: formData.get("max_marks"),
    entries,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the marks." };
  }

  const input = parsed.data;

  const over = input.entries.filter((e) => e.marks !== null && e.marks > input.max_marks);
  if (over.length > 0) {
    return { error: `${over.length} mark(s) are above the maximum of ${input.max_marks}.` };
  }

  /*
   * A class test is one teacher's own sheet, so an upsert is enough here —
   * unlike a term exam, nothing downstream reads a "submitted" flag and could
   * be misled by a partial write. The send action refuses while no mark exists.
   */
  const { error } = await supabase.from("class_test_marks").upsert(
    input.entries.map((e) => ({
      class_test_id: input.class_test_id,
      student_id: e.student_id,
      marks_obtained: e.absent ? null : e.marks,
      is_absent: e.absent,
      entered_at: new Date().toISOString(),
    })),
    { onConflict: "class_test_id,student_id" },
  );

  if (error) {
    if (error.message.includes("exceeds max_marks")) {
      return { error: "One mark is above the maximum for this test." };
    }
    if (error.message.includes("row-level security")) {
      return { error: "That test belongs to another teacher." };
    }
    return { error: `Could not save the marks: ${error.message}` };
  }

  // Marks entered, but not sent: the status says exactly that.
  const { data: test } = await supabase
    .from("class_tests")
    .select("status")
    .eq("id", input.class_test_id)
    .maybeSingle();

  if (test?.status === "draft") {
    await supabase
      .from("class_tests")
      .update({ status: "marks_entered" })
      .eq("id", input.class_test_id);
  }

  revalidatePath("/teacher/class-tests");

  return {
    ok: true,
    notice:
      `Marks saved for ${input.entries.length} students. ` +
      `Nothing has been sent to guardians yet.`,
  };
}

