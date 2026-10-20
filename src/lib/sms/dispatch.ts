import "server-only";

import { createClient } from "@/lib/supabase/server";
import { countSegments } from "@/lib/sms/segments";
import { renderTemplate } from "@/lib/sms/templates";
import { sendSms, smsIsSimulated } from "@/lib/sms";

/**
 * The notification dispatcher.
 *
 * Takes a batch of queued jobs, renders each from its template and payload,
 * counts the billable segments, hands it to the SMS layer and records the
 * outcome.
 *
 * NO PROVIDER IS CONNECTED. Every dispatch therefore runs in simulate mode:
 * the message is rendered, costed and logged, and nothing reaches a phone. A
 * simulated dispatch settles its job as **skipped**, never as **sent** — so
 * the office's reporting cannot show a simulated run as delivered traffic, and
 * a later live run is distinguishable from today's rehearsal by status alone.
 *
 * That distinction is the one thing in this file worth being strict about. It
 * would be easy, and wrong, to mark a simulated job 'sent' so the screens look
 * tidy; the screens would then be lying about whether four hundred guardians
 * had been told their children's results.
 */

export type DispatchOutcome = {
  jobId: string;
  type: string;
  status: "sent" | "failed" | "skipped";
  body: string;
  segments: number;
  isUnicode: boolean;
  mode: "simulate" | "live";
  error?: string;
};

export type DispatchSummary = {
  claimed: number;
  simulated: number;
  sent: number;
  failed: number;
  totalSegments: number;
  unicodeMessages: number;
  simulatedMode: boolean;
  outcomes: DispatchOutcome[];
  /** Set when nothing could be dispatched for a reason worth reporting. */
  note?: string;
};

type ClaimedJob = {
  id: string;
  type: string;
  student_id: string | null;
  teacher_id: string | null;
  target_phone: string;
  payload: Record<string, string | number | null>;
};

type Template = {
  type: string;
  language: string;
  body: string;
};

/**
 * Renders and dispatches up to `limit` queued jobs.
 *
 * `language` picks which template variant to use. It is a parameter rather
 * than a setting because it is a cost decision: the same message in Bangla is
 * UCS-2 at 70 characters per segment against 160 for Latin, so sending a whole
 * day's summaries in Bangla can cost three times as much.
 */
export async function dispatchQueued(
  limit = 50,
  language: "en" | "bn" = "en",
): Promise<DispatchSummary> {
  const supabase = await createClient();
  const simulatedMode = smsIsSimulated();

  const { data: templateRows } = await supabase
    .from("notification_templates")
    .select("type, language, body")
    .eq("is_active", true)
    .eq("is_default", true);

  const templates = new Map<string, Template>();
  for (const row of (templateRows ?? []) as Template[]) {
    templates.set(`${row.type}|${row.language}`, row);
  }

  const { data: claimed, error } = await supabase.rpc("claim_notification_jobs", {
    p_limit: limit,
  });

  if (error) {
    return {
      claimed: 0, simulated: 0, sent: 0, failed: 0,
      totalSegments: 0, unicodeMessages: 0, simulatedMode,
      outcomes: [],
      note: `Could not claim jobs: ${error.message}`,
    };
  }

  const jobs = (claimed ?? []) as ClaimedJob[];

  if (jobs.length === 0) {
    return {
      claimed: 0, simulated: 0, sent: 0, failed: 0,
      totalSegments: 0, unicodeMessages: 0, simulatedMode,
      outcomes: [],
      note: "Nothing is due. Queue some messages first, or wait for the scheduled time.",
    };
  }

  const outcomes: DispatchOutcome[] = [];

  for (const job of jobs) {
    // Fall back to English when a language has no template for this type: a
    // missing Bangla template must not silently drop the message.
    const template =
      templates.get(`${job.type}|${language}`) ?? templates.get(`${job.type}|en`);

    if (!template) {
      await supabase.rpc("settle_notification_job", {
        p_job_id: job.id,
        p_status: "failed",
        p_body: null,
        p_segments: null,
        p_is_unicode: null,
        p_error: `No active template for ${job.type}`,
      });

      outcomes.push({
        jobId: job.id, type: job.type, status: "failed",
        body: "", segments: 0, isUnicode: false, mode: simulatedMode ? "simulate" : "live",
        error: `No active template for ${job.type}. Add one under Notifications.`,
      });
      continue;
    }

    const rendered = renderTemplate(template.body, job.payload ?? {});
    const segmentInfo = countSegments(rendered.body);

    // A template asking for a fact the job does not carry is a configuration
    // error, and sending the half-filled text would be worse than not sending.
    if (rendered.missing.length > 0) {
      await supabase.rpc("settle_notification_job", {
        p_job_id: job.id,
        p_status: "failed",
        p_body: rendered.body,
        p_segments: segmentInfo.segments,
        p_is_unicode: segmentInfo.isUnicode,
        p_error: `Template wants ${rendered.missing.join(", ")}, which this job has no value for`,
      });

      outcomes.push({
        jobId: job.id, type: job.type, status: "failed",
        body: rendered.body,
        segments: segmentInfo.segments,
        isUnicode: segmentInfo.isUnicode,
        mode: simulatedMode ? "simulate" : "live",
        error: `The template asks for ${rendered.missing.join(", ")}, which this message has no value for.`,
      });
      continue;
    }

    const result = await sendSms({
      to: job.target_phone,
      body: rendered.body,
      jobId: job.id,
      kind: job.type as "daily_attendance" | "exam_result" | "class_test_result" | "custom",
    });

    /*
     * A simulated dispatch is 'skipped', not 'sent'.
     *
     * Nothing reached a phone, so recording it as sent would make the office's
     * delivery figures describe messages that do not exist. 'skipped' is the
     * schema's own word for "deliberately not delivered", which is exactly
     * what happened.
     */
    const status: DispatchOutcome["status"] =
      result.mode === "simulate" ? "skipped" : result.delivered ? "sent" : "failed";

    await supabase.rpc("settle_notification_job", {
      p_job_id: job.id,
      p_status: status,
      p_body: rendered.body,
      p_segments: segmentInfo.segments,
      p_is_unicode: segmentInfo.isUnicode,
      p_error: result.error ?? (result.mode === "simulate"
        ? "SIMULATED — no provider is connected, so nothing was sent."
        : null),
    });

    outcomes.push({
      jobId: job.id,
      type: job.type,
      status,
      body: rendered.body,
      segments: segmentInfo.segments,
      isUnicode: segmentInfo.isUnicode,
      mode: result.mode,
      error: result.logged ? result.error : "the attempt could not be recorded",
    });
  }

  return {
    claimed: jobs.length,
    simulated: outcomes.filter((o) => o.mode === "simulate").length,
    sent: outcomes.filter((o) => o.status === "sent").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    totalSegments: outcomes.reduce((n, o) => n + o.segments, 0),
    unicodeMessages: outcomes.filter((o) => o.isUnicode).length,
    simulatedMode,
    outcomes,
  };
}
