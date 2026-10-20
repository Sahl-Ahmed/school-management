"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Admit-card issue, ID-card issue and card revocation.
 *
 * None of these decides eligibility. `issue_admit_card` re-checks it inside its
 * own transaction, so the office cannot issue a blocked card from this screen
 * any more than a student can from theirs — which is the brief's requirement,
 * and the reason the check is not written here where it could drift.
 */

export type CardState = {
  ok?: boolean;
  error?: string;
  notice?: string;
  seq?: number;
};

const admitSchema = z.object({
  student_id: z.uuid(),
  exam_id: z.uuid(),
});

export async function issueAdmitCard(
  prev: CardState,
  formData: FormData,
): Promise<CardState> {
  const supabase = await createClient();

  const parsed = admitSchema.safeParse({
    student_id: formData.get("student_id"),
    exam_id: formData.get("exam_id"),
  });
  if (!parsed.success) return { error: "That student or exam is not valid." };

  const { data, error } = await supabase.rpc("issue_admit_card", {
    p_student_id: parsed.data.student_id,
    p_exam_id: parsed.data.exam_id,
  });

  if (error) {
    if (error.message.includes("admit card blocked")) {
      return {
        error:
          "Blocked — the requirements are not met. " +
          "The reasons are listed against the student in the table.",
      };
    }
    if (error.message.includes("may not issue")) {
      return { error: "You may not issue that admit card." };
    }
    return { error: `Could not issue: ${error.message}` };
  }

  const result = data as { seat_token: string };

  revalidatePath(`/authority/cards`);

  return {
    ok: true,
    seq: (prev.seq ?? 0) + 1,
    notice: `Issued. Seat code ${result.seat_token}. Reprinting gives the same code.`,
  };
}

// ---------------------------------------------------------------------------
const overrideSchema = z.object({
  student_id: z.uuid(),
  exam_id: z.uuid(),
  reason: z.string().trim().min(5, "Give a reason for the exception").max(500),
});

/**
 * The audited exception.
 *
 * Refused by the database unless the exam's rule has `allow_override`, which is
 * off until the owner says otherwise. Both halves matter: an administrator-only
 * check and a per-exam switch, so enabling exceptions is a deliberate act
 * rather than a side effect of being an admin.
 */
export async function overrideAdmitCard(
  _prev: CardState,
  formData: FormData,
): Promise<CardState> {
  const supabase = await createClient();

  const parsed = overrideSchema.safeParse({
    student_id: formData.get("student_id"),
    exam_id: formData.get("exam_id"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the details." };
  }

  const { error } = await supabase.rpc("override_admit_card", {
    p_student_id: parsed.data.student_id,
    p_exam_id: parsed.data.exam_id,
    p_reason: parsed.data.reason,
  });

  if (error) {
    if (error.message.includes("not permitted for this exam")) {
      return {
        error:
          "Exceptions are switched off for this exam. The school owner has not " +
          "approved overrides; enabling them is a change to the exam's rule.",
      };
    }
    if (error.message.includes("only a school administrator")) {
      return { error: "Only a school administrator may approve an exception." };
    }
    if (error.message.includes("requires a reason")) {
      return { error: "An exception requires a reason." };
    }
    return { error: `Could not record the exception: ${error.message}` };
  }

  revalidatePath("/authority/cards");

  return {
    ok: true,
    notice:
      "Exception recorded and audited. The card can now be issued, and the " +
      "card itself prints a line saying it was issued by exception.",
  };
}

// ---------------------------------------------------------------------------
/**
 * Issues a public card link.
 *
 * The token is generated HERE with a CSPRNG rather than in SQL, because
 * Postgres' `random()` is not cryptographically secure and this value is the
 * only thing standing between a stranger and a student's card page. 32 bytes
 * base64url is 43 characters, comfortably over the 32-character floor the
 * schema enforces.
 */
export async function issueIdCard(
  prev: CardState,
  formData: FormData,
): Promise<CardState> {
  const supabase = await createClient();

  const studentId = String(formData.get("student_id") ?? "");
  const templateId = String(formData.get("template_id") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (!studentId) return { error: "No student was given." };

  const token = randomBytes(32).toString("base64url");

  const { data, error } = await supabase.rpc("issue_qr_token", {
    p_student_id: studentId,
    p_token: token,
    p_template_id: templateId || null,
    p_replacing_reason: reason || null,
  });

  if (error) {
    if (error.message.includes("no active enrollment")) {
      return { error: "That student has no active enrollment in the current year." };
    }
    if (error.message.includes("no ID card template")) {
      return { error: "No ID card template is configured." };
    }
    if (error.message.includes("only the school office")) {
      return { error: "Only the school office may issue an ID card." };
    }
    return { error: `Could not issue the card: ${error.message}` };
  }

  const result = data as { replaced_previous: boolean; fields: string[] };

  revalidatePath("/authority/cards");

  return {
    ok: true,
    seq: (prev.seq ?? 0) + 1,
    notice:
      (result.replaced_previous
        ? "New card issued and the previous link revoked, so a lost card stops resolving. "
        : "Card issued. ") +
      `The public page shows ${result.fields.length} field` +
      `${result.fields.length === 1 ? "" : "s"} — exactly what the card prints.`,
  };
}

// ---------------------------------------------------------------------------
export async function revokeIdCard(
  _prev: CardState,
  formData: FormData,
): Promise<CardState> {
  const supabase = await createClient();

  const tokenId = String(formData.get("token_id") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (!tokenId) return { error: "No card was given." };
  if (reason.trim().length < 3) {
    return { error: "Say why the card is being revoked — it is kept on the record." };
  }

  const { error } = await supabase.rpc("revoke_qr_token", {
    p_token_id: tokenId,
    p_reason: reason.trim(),
  });

  if (error) {
    if (error.message.includes("already revoked")) {
      return { error: "That card is already revoked." };
    }
    return { error: `Could not revoke: ${error.message}` };
  }

  revalidatePath("/authority/cards");

  return {
    ok: true,
    notice:
      "Revoked. The QR on the printed card no longer resolves. Issue a " +
      "replacement when the student needs one.",
  };
}

// ---------------------------------------------------------------------------
/**
 * Creates (or refreshes) an exam's admit-card rule.
 *
 * The cutoff defaults to the exam's own month, which is the policy the owner
 * chose. `default_admit_card_rule` derives it, so the office does not have to
 * remember the rule when configuring a new exam.
 */
export async function configureAdmitRule(
  _prev: CardState,
  formData: FormData,
): Promise<CardState> {
  const supabase = await createClient();

  const examId = String(formData.get("exam_id") ?? "");
  if (!examId) return { error: "No exam was given." };

  const { error } = await supabase.rpc("default_admit_card_rule", { p_exam_id: examId });

  if (error) {
    if (error.message.includes("only the school office")) {
      return { error: "Only the school office may configure admit card rules." };
    }
    return { error: `Could not configure the rule: ${error.message}` };
  }

  revalidatePath("/authority/cards");

  return {
    ok: true,
    notice:
      "Rule set: feedback must be complete, monthly fees must be clear through " +
      "the exam's own month, and the exam fee must be paid. Exceptions are off.",
  };
}
