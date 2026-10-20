"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Grading policy, as configuration.
 *
 * The brief is explicit that the exact scale, the pass rule and the
 * missing-mark handling are the owner's decision, so none of it is in code.
 * This screen writes grading_scales and grade_bands; publishing reads them.
 *
 * A change here does not re-grade a published exam: each exam keeps the scale
 * it was published with, and published_results holds a frozen snapshot.
 */

export type GradingState = {
  ok?: boolean;
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string[]>;
};

const ruleSchema = z.object({
  scale_id: z.uuid(),
  pass_rule: z.enum(["all_subjects", "average", "allow_one_fail"]),
  subject_pass_pct: z.coerce.number().min(0).max(100),
  fail_zeroes_gpa: z.coerce.boolean(),
  no_gpa_below_level: z.string().optional(),
});

export async function updateGradingRules(
  _prev: GradingState,
  formData: FormData,
): Promise<GradingState> {
  const supabase = await createClient();

  const parsed = ruleSchema.safeParse({
    scale_id: formData.get("scale_id"),
    pass_rule: formData.get("pass_rule"),
    subject_pass_pct: formData.get("subject_pass_pct"),
    // An unchecked checkbox sends nothing at all, which is the false case.
    fail_zeroes_gpa: formData.get("fail_zeroes_gpa") === "on",
    no_gpa_below_level: formData.get("no_gpa_below_level") ?? undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the grading rules.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  const { error } = await supabase
    .from("grading_scales")
    .update({
      pass_rule: input.pass_rule,
      subject_pass_pct: input.subject_pass_pct,
      fail_zeroes_gpa: input.fail_zeroes_gpa,
      no_gpa_below_level: input.no_gpa_below_level
        ? Number(input.no_gpa_below_level)
        : null,
    })
    .eq("id", input.scale_id);

  if (error) {
    if (error.message.includes("row-level security")) {
      return { error: "Only the school office can change the grading policy." };
    }
    return { error: `Could not save the rules: ${error.message}` };
  }

  revalidatePath("/authority/grading");

  return {
    ok: true,
    notice:
      "Grading rules saved. They apply to exams published from now on; " +
      "results already published keep the policy they were published under.",
  };
}

// ---------------------------------------------------------------------------
const bandSchema = z.object({
  scale_id: z.uuid(),
  grade: z.string().trim().min(1, "Give the band a grade letter").max(10),
  min_pct: z.coerce.number().min(0).max(100),
  max_pct: z.coerce.number().min(0).max(100),
  grade_point: z.coerce.number().min(0).max(10),
  is_pass: z.coerce.boolean(),
});

export async function saveGradeBand(
  _prev: GradingState,
  formData: FormData,
): Promise<GradingState> {
  const supabase = await createClient();

  const parsed = bandSchema.safeParse({
    scale_id: formData.get("scale_id"),
    grade: formData.get("grade"),
    min_pct: formData.get("min_pct"),
    max_pct: formData.get("max_pct"),
    grade_point: formData.get("grade_point"),
    is_pass: formData.get("is_pass") === "on",
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the band.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  if (input.max_pct < input.min_pct) {
    return { error: "The band's top percentage cannot be below its bottom one." };
  }

  const { error } = await supabase
    .from("grade_bands")
    .upsert(
      {
        scale_id: input.scale_id,
        grade: input.grade,
        min_pct: input.min_pct,
        max_pct: input.max_pct,
        grade_point: input.grade_point,
        is_pass: input.is_pass,
      },
      { onConflict: "scale_id,grade" },
    );

  if (error) {
    // The exclusion constraint is what guarantees one percentage maps to one
    // grade, so overlap is reported as the real problem it is.
    if (error.message.includes("grade_bands_no_overlap")) {
      return {
        error:
          `${input.min_pct}–${input.max_pct}% overlaps an existing band. ` +
          `Bands may not overlap, or a percentage would have two grades.`,
      };
    }
    if (error.message.includes("row-level security")) {
      return { error: "Only the school office can change the grading bands." };
    }
    return { error: `Could not save the band: ${error.message}` };
  }

  revalidatePath("/authority/grading");
  return { ok: true, notice: `Band ${input.grade} saved.` };
}

// ---------------------------------------------------------------------------
export async function deleteGradeBand(
  _prev: GradingState,
  formData: FormData,
): Promise<GradingState> {
  const supabase = await createClient();

  const id = String(formData.get("band_id") ?? "");
  if (!id) return { error: "No band was given." };

  const { error } = await supabase.from("grade_bands").delete().eq("id", id);

  if (error) return { error: `Could not remove the band: ${error.message}` };

  revalidatePath("/authority/grading");
  return {
    ok: true,
    notice:
      "Band removed. A percentage now inside no band grades as blank, so check " +
      "the table covers 0 to 100 before the next publication.",
  };
}
