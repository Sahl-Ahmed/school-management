"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Student feedback submission.
 *
 * Everything that matters happens in `submit_feedback` (migration 0017): the
 * anonymous ratings and the student's own completion marker are written in one
 * transaction, and the teacher being rated comes from the target row rather
 * than from this payload — so a crafted request cannot attribute a rating to
 * someone else.
 *
 * The consequence worth stating plainly, because the UI must warn about it: a
 * submitted rating CANNOT be changed or withdrawn. Nothing records which
 * ratings were whose, so there is nothing to go back and find. That is the
 * price of real anonymity and it is the intended behaviour.
 */

export type FeedbackState = {
  ok?: boolean;
  error?: string;
  notice?: string;
  campaignComplete?: boolean;
};

const ratingSchema = z.object({
  question_id: z.uuid(),
  rating: z.coerce.number().int().min(0).max(100),
});

const schema = z.object({
  campaign_id: z.uuid(),
  target_id: z.uuid(),
  comment: z.string().trim().max(2000).optional(),
  ratings: z.array(ratingSchema).min(1, "Answer every question before submitting"),
});

export async function submitFeedback(
  _prev: FeedbackState,
  formData: FormData,
): Promise<FeedbackState> {
  const supabase = await createClient();

  const raw = formData.get("ratings");
  let ratings: unknown = [];

  if (typeof raw === "string" && raw.length > 0) {
    try {
      ratings = JSON.parse(raw);
    } catch {
      return { error: "Your answers could not be read. Please choose them again." };
    }
  }

  const parsed = schema.safeParse({
    campaign_id: formData.get("campaign_id"),
    target_id: formData.get("target_id"),
    // FormData.get returns null for an absent field and Zod's .optional()
    // rejects null, so this is normalised.
    comment: formData.get("comment") ?? undefined,
    ratings,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your answers." };
  }

  const input = parsed.data;

  const { data, error } = await supabase.rpc("submit_feedback", {
    p_campaign_id: input.campaign_id,
    p_target_id: input.target_id,
    p_ratings: input.ratings,
    p_comment: input.comment || null,
  });

  if (error) return { error: humanise(error.message) };

  const result = data as { campaign_complete: boolean; targets_done: number; targets_total: number };

  revalidatePath("/student/feedback");
  revalidatePath("/student/documents");
  revalidatePath("/student");

  return {
    ok: true,
    campaignComplete: result.campaign_complete,
    notice: result.campaign_complete
      ? "Thank you — your feedback is complete. Your answers are anonymous: " +
        "your teachers see only the combined ratings for their class, never who said what."
      : `Saved. ${result.targets_total - result.targets_done} form` +
        `${result.targets_total - result.targets_done === 1 ? "" : "s"} left.`,
  };
}

function humanise(message: string): string {
  if (message.includes("not open")) {
    return "Feedback is not open at the moment. The school sets the window.";
  }
  if (message.includes("already been submitted")) {
    return "You have already submitted this form. A submitted rating cannot be changed, because nothing records which answers were yours.";
  }
  if (message.includes("no such feedback form")) {
    return "That form is not one of yours.";
  }
  if (message.includes("not taught enough periods")) {
    return "This teacher has not taught enough lessons to be reviewed.";
  }
  if (message.includes("expected")) {
    return "Please answer every question before submitting.";
  }
  if (message.includes("outside this question")) {
    return "One of those ratings is outside the allowed range.";
  }
  if (message.includes("only a signed-in student")) {
    return "Only a student can submit feedback.";
  }
  return `Could not submit: ${message}`;
}
