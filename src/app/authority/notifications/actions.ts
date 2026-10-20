"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { dispatchQueued } from "@/lib/sms/dispatch";
import { smsIsSimulated } from "@/lib/sms";
import { countSegments } from "@/lib/sms/segments";
import { templatePlaceholders } from "@/lib/sms/templates";
// Not declared in this file: every export of a "use server" module becomes a
// server-action reference, so a plain string exported from here would reach
// the client as a function proxy. See src/app/authority/notifications/copy.ts.
import { SIMULATION_NOTE } from "./copy";

/**
 * The notification queue, as the office drives it.
 *
 * NO MESSAGE LEAVES THIS SYSTEM. No provider is connected, and the owner has
 * asked that none be connected yet. Every action here therefore ends in a
 * simulated dispatch: the message is rendered, costed and recorded, and nothing
 * reaches a phone. Each notice says so in those words, because an office that
 * believes four hundred guardians were told their children's results — when
 * they were not — is the worst outcome this module can produce.
 */

export type QueueState = {
  ok?: boolean;
  error?: string;
  notice?: string;
  detail?: string;
  simulated?: boolean;
};

const dateSchema = z.object({
  job_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
});

export async function queueDailyAttendance(
  _prev: QueueState,
  formData: FormData,
): Promise<QueueState> {
  const supabase = await createClient();

  const parsed = dateSchema.safeParse({ job_date: formData.get("job_date") });
  if (!parsed.success) return { error: "Choose a date to summarise." };

  const { data, error } = await supabase.rpc("queue_daily_attendance", {
    p_date: parsed.data.job_date,
  });

  if (error) {
    if (error.message.includes("only the school office")) {
      return { error: "Only the school office can queue notifications." };
    }
    return { error: `Could not queue: ${error.message}` };
  }

  const r = data as {
    queued: number;
    already_queued: number;
    no_contact: number;
    no_submitted_attendance: number;
    enabled: boolean;
    scheduled_for: string;
  };

  revalidatePath("/authority/notifications");

  const parts: string[] = [
    `${r.queued} summar${r.queued === 1 ? "y" : "ies"} queued`,
  ];
  if (r.already_queued > 0) {
    parts.push(
      `${r.already_queued} already existed and were not duplicated — ` +
      `one summary per student per day is enforced by the database, not by this screen`,
    );
  }
  if (r.no_submitted_attendance > 0) {
    parts.push(
      `${r.no_submitted_attendance} student${r.no_submitted_attendance === 1 ? "" : "s"} skipped ` +
      `because no teacher submitted attendance for them that day — a summary ` +
      `reading "present 0/0" would look like an absence`,
    );
  }
  if (r.no_contact > 0) {
    parts.push(`${r.no_contact} skipped for having no phone number on record`);
  }

  /*
   * `detail` is deliberately not used to repeat the "switched off" warning.
   * The form already shows that as a standing banner, and printing it again as
   * an outcome made the same sentence appear twice in a row after every queue —
   * which reads as a stutter rather than as emphasis.
   */
  return {
    ok: true,
    notice: `${parts.join(". ")}.`,
    simulated: smsIsSimulated(),
  };
}

// ---------------------------------------------------------------------------
export async function queueExamResults(
  _prev: QueueState,
  formData: FormData,
): Promise<QueueState> {
  const supabase = await createClient();

  const examId = String(formData.get("exam_id") ?? "");
  if (!examId) return { error: "Choose an exam." };

  const { data, error } = await supabase.rpc("queue_exam_results", {
    p_exam_id: examId,
  });

  if (error) {
    if (error.message.includes("not published yet")) {
      return {
        error:
          "Those results are not published. Publish them first — announcing a " +
          "draft result is the one thing this must never do.",
      };
    }
    return { error: `Could not queue: ${error.message}` };
  }

  const r = data as { queued: number; already_queued: number; no_contact: number };

  revalidatePath("/authority/notifications");

  return {
    ok: true,
    notice:
      `${r.queued} result message${r.queued === 1 ? "" : "s"} queued` +
      (r.already_queued > 0
        ? `. ${r.already_queued} were already queued and were not duplicated`
        : "") +
      (r.no_contact > 0 ? `. ${r.no_contact} had no phone number on record` : "") +
      ".",
    simulated: smsIsSimulated(),
  };
}

// ---------------------------------------------------------------------------
/**
 * Runs the dispatcher.
 *
 * In simulate mode each job settles as **skipped**, never as sent, so the
 * delivery figures on this screen describe reality rather than a rehearsal.
 */
export async function runDispatcher(
  _prev: QueueState,
  formData: FormData,
): Promise<QueueState> {
  const language = formData.get("language") === "bn" ? "bn" : "en";
  const limit = Number(formData.get("limit") ?? 50) || 50;

  const summary = await dispatchQueued(limit, language);

  revalidatePath("/authority/notifications");

  if (summary.note && summary.claimed === 0) {
    return { ok: true, notice: summary.note, simulated: summary.simulatedMode };
  }

  const failed = summary.failed;

  return {
    ok: true,
    notice:
      `${summary.claimed} message${summary.claimed === 1 ? "" : "s"} processed in ` +
      `${language === "bn" ? "Bangla" : "English"}: ` +
      `${summary.totalSegments} billable segment${summary.totalSegments === 1 ? "" : "s"}` +
      (summary.unicodeMessages > 0
        ? ` (${summary.unicodeMessages} counted at 70 characters per segment, not 160, because they contain Bangla)`
        : "") +
      (failed > 0 ? `. ${failed} failed — see the delivery log below` : "") +
      ".",
    detail: summary.simulatedMode ? SIMULATION_NOTE : undefined,
    simulated: summary.simulatedMode,
  };
}

// ---------------------------------------------------------------------------
const templateSchema = z.object({
  template_id: z.uuid(),
  body: z.string().trim().min(5, "A message needs some words").max(900),
});

export async function updateTemplate(
  _prev: QueueState,
  formData: FormData,
): Promise<QueueState> {
  const supabase = await createClient();

  const parsed = templateSchema.safeParse({
    template_id: formData.get("template_id"),
    body: formData.get("body"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the message." };
  }

  const { error } = await supabase
    .from("notification_templates")
    .update({
      body: parsed.data.body,
      // Kept in step with the body, so the preview and the dispatcher agree
      // about which facts a template needs.
      placeholders: templatePlaceholders(parsed.data.body),
    })
    .eq("id", parsed.data.template_id);

  if (error) {
    if (error.message.includes("row-level security")) {
      return { error: "Only the school office can change a message." };
    }
    return { error: `Could not save: ${error.message}` };
  }

  const info = countSegments(parsed.data.body);

  revalidatePath("/authority/notifications");

  return {
    ok: true,
    notice:
      `Saved. As written it is ${info.segments} segment` +
      `${info.segments === 1 ? "" : "s"} per message` +
      (info.isUnicode
        ? " — it contains Bangla, so a segment is 70 characters rather than 160"
        : "") +
      ".",
    simulated: smsIsSimulated(),
  };
}

// ---------------------------------------------------------------------------
/** Cancels queued messages that have not been dispatched. */
export async function cancelQueued(
  _prev: QueueState,
  formData: FormData,
): Promise<QueueState> {
  const supabase = await createClient();

  const type = String(formData.get("type") ?? "");
  if (!type) return { error: "No message type was given." };

  const { data, error } = await supabase
    .from("notification_jobs")
    .update({ status: "cancelled", last_error: "cancelled by the school office" })
    .in("status", ["pending", "queued"])
    .eq("type", type)
    .select("id");

  if (error) return { error: `Could not cancel: ${error.message}` };

  revalidatePath("/authority/notifications");

  return {
    ok: true,
    notice:
      `${(data ?? []).length} queued message${(data ?? []).length === 1 ? "" : "s"} cancelled. ` +
      `Cancelled messages keep their place in the record rather than vanishing, ` +
      `so the dedupe key still blocks a duplicate for the same student and day.`,
    simulated: smsIsSimulated(),
  };
}
