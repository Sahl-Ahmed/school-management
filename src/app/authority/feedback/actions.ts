"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Feedback campaign management for the office.
 *
 * A campaign is created as a draft with its questions, then the forms are
 * generated from the term's assignments, and only then can it be opened. That
 * order is enforced here and in the database: `generate_feedback_targets`
 * refuses without questions, and opening a campaign with no forms would block
 * every admit card for a round nobody can complete.
 */

/*
 * NOTE: the proposed question wording lives in ./questions.ts, not here.
 * Every export of a "use server" module becomes a server-action reference, so
 * a plain array exported from this file reaches the client as a function proxy.
 */

export type CampaignState = {
  ok?: boolean;
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string[]>;
  seq?: number;
};

const questionSchema = z.object({
  prompt: z.string().trim().min(5, "A question needs at least a few words").max(300),
  prompt_bn: z.string().trim().max(300).optional(),
});

const createSchema = z.object({
  academic_year_id: z.uuid(),
  term_id: z.uuid("Choose a term"),
  name: z.string().trim().min(3, "Give the round a name").max(120),
  opens_at: z.string().optional(),
  closes_at: z.string().optional(),
  min_periods_taught: z.coerce.number().int().min(0).max(200).default(1),
  scale_max: z.coerce.number().int().min(2).max(10).default(5),
  blocks_admit_card: z.coerce.boolean().default(true),
  questions: z.array(questionSchema).min(2, "Use two or three questions").max(3),
});

export async function createCampaign(
  prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  const supabase = await createClient();

  const raw = formData.get("questions");
  let questions: unknown = [];
  if (typeof raw === "string" && raw.length > 0) {
    try {
      questions = JSON.parse(raw);
    } catch {
      return { error: "The questions could not be read. Please re-enter them." };
    }
  }

  const parsed = createSchema.safeParse({
    academic_year_id: formData.get("academic_year_id"),
    term_id: formData.get("term_id"),
    name: formData.get("name"),
    opens_at: formData.get("opens_at") ?? undefined,
    closes_at: formData.get("closes_at") ?? undefined,
    min_periods_taught: formData.get("min_periods_taught") ?? undefined,
    scale_max: formData.get("scale_max") ?? undefined,
    blocks_admit_card: formData.get("blocks_admit_card") === "on",
    questions,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the round's details.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  const { data: campaign, error } = await supabase
    .from("feedback_campaigns")
    .insert({
      academic_year_id: input.academic_year_id,
      term_id: input.term_id,
      name: input.name,
      status: "draft",
      opens_at: input.opens_at ? new Date(input.opens_at).toISOString() : null,
      closes_at: input.closes_at ? new Date(input.closes_at).toISOString() : null,
      min_periods_taught: input.min_periods_taught,
      blocks_admit_card: input.blocks_admit_card,
    })
    .select("id")
    .single();

  if (error) {
    if (error.message.includes("feedback_campaigns_term_id_name_key")) {
      return { error: "A round with that name already exists for this term." };
    }
    if (error.message.includes("window_order")) {
      return { error: "The closing time must be after the opening time." };
    }
    if (error.message.includes("row-level security")) {
      return { error: "Only the school office can create a feedback round." };
    }
    return { error: `Could not create the round: ${error.message}` };
  }

  const { error: qError } = await supabase.from("feedback_questions").insert(
    input.questions.map((q, i) => ({
      campaign_id: campaign.id,
      prompt: q.prompt,
      prompt_bn: q.prompt_bn || null,
      order_no: i + 1,
      scale_min: 1,
      scale_max: input.scale_max,
    })),
  );

  if (qError) {
    // The campaign exists but has no questions, which would make it
    // ungeneratable. Removing it is cleaner than leaving a half-built round in
    // the office's list.
    await supabase.from("feedback_campaigns").delete().eq("id", campaign.id);
    return { error: `Could not save the questions: ${qError.message}` };
  }

  revalidatePath("/authority/feedback");

  return {
    ok: true,
    seq: (prev.seq ?? 0) + 1,
    notice:
      `"${input.name}" created as a draft with ${input.questions.length} questions. ` +
      `Generate the forms next, then open it.`,
  };
}

// ---------------------------------------------------------------------------
export async function generateTargets(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  const supabase = await createClient();

  const campaignId = String(formData.get("campaign_id") ?? "");
  if (!campaignId) return { error: "No round was given." };

  const { data, error } = await supabase.rpc("generate_feedback_targets", {
    p_campaign_id: campaignId,
  });

  if (error) {
    if (error.message.includes("before generating forms")) {
      return { error: "Add the rating questions before generating forms." };
    }
    if (error.message.includes("only the school office")) {
      return { error: "Only the school office can generate forms." };
    }
    return { error: `Could not generate forms: ${error.message}` };
  }

  const result = data as {
    forms: number;
    skipped_too_few_periods: number;
    pairs_considered: number;
  };

  revalidatePath(`/authority/feedback/${campaignId}`);
  revalidatePath("/authority/feedback");

  return {
    ok: true,
    notice:
      `${result.forms} form${result.forms === 1 ? "" : "s"} ready. ` +
      (result.skipped_too_few_periods > 0
        ? `${result.skipped_too_few_periods} student-teacher pair` +
          `${result.skipped_too_few_periods === 1 ? " was" : "s were"} left out for ` +
          `too few submitted lessons. `
        : "") +
      `Re-running this is safe: it refreshes lesson counts and never clears a ` +
      `submitted form.`,
  };
}

// ---------------------------------------------------------------------------
const statusSchema = z.object({
  campaign_id: z.uuid(),
  status: z.enum(["draft", "open", "closed"]),
});

export async function setCampaignStatus(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  const supabase = await createClient();

  const parsed = statusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "That status is not valid." };

  const { campaign_id, status } = parsed.data;

  if (status === "open") {
    // Opening a round with no forms would block every admit card for a round
    // nobody can complete, so it is refused with the reason.
    const { count } = await supabase
      .from("feedback_targets")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign_id);

    if ((count ?? 0) === 0) {
      return {
        error:
          "This round has no forms yet, so nobody could complete it — and if it " +
          "blocks admit cards, every card would stay blocked. Generate the forms first.",
      };
    }
  }

  const { error } = await supabase
    .from("feedback_campaigns")
    .update({ status })
    .eq("id", campaign_id);

  if (error) return { error: `Could not change the status: ${error.message}` };

  revalidatePath(`/authority/feedback/${campaign_id}`);
  revalidatePath("/authority/feedback");

  const words: Record<string, string> = {
    draft: "back to draft. Students cannot see it.",
    open: "open. Students can submit feedback now.",
    closed: "closed. No further feedback can be submitted.",
  };

  return { ok: true, notice: `Round ${words[status]}` };
}
