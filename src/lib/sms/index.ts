import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { countSegments } from "@/lib/sms/segments";

// Re-exported so callers have one import for the SMS layer.
export { countSegments, estimateSegments, type SegmentInfo } from "@/lib/sms/segments";

/**
 * SMS dispatch behind a provider interface.
 *
 * TWO MODES, and the difference is never hidden:
 *
 *   simulate — nothing is sent anywhere. The message is recorded in
 *              sms_delivery_logs with mode = 'simulate'. This is the default
 *              and the only mode available until a provider account is
 *              connected. A simulated send is NOT a working SMS feature and is
 *              never reported as one.
 *
 *   live     — the message goes to the configured provider (sms.bd or
 *              compatible). Requires SMS_API_KEY and SMS_SENDER_ID.
 *
 * Billable segments are counted because Bangla is UCS-2: a Bangla message fits
 * 70 characters per segment against 160 for GSM-7 Latin. A 160-character Bangla
 * message is three segments, not one, and the school is billed accordingly.
 */

export type SendRequest = {
  to: string;
  body: string;
  /** Links the delivery log to a queued notification job, when there is one. */
  jobId?: string;
  /** Appears in the log so OTP traffic is distinguishable from bulk sends. */
  kind: "account_otp" | "daily_attendance" | "exam_result" | "class_test_result" | "custom";
};

export type SendResult = {
  mode: "simulate" | "live";
  delivered: boolean;
  providerMessageId: string | null;
  segments: number;
  isUnicode: boolean;
  /**
   * Whether the attempt was written to sms_delivery_logs.
   *
   * Checked rather than assumed, because the log is the only record that a
   * message was sent and what it cost — and in simulate mode the log IS the
   * entire behaviour, so failing to write it means nothing happened at all.
   */
  logged: boolean;
  error?: string;
};

/**
 * Sends, or simulates sending, one message and records the attempt.
 *
 * The returned `mode` is what callers must surface to the user. A caller that
 * reports success without checking it would be claiming an SMS was sent when
 * nothing left the building.
 */
export async function sendSms(request: SendRequest): Promise<SendResult> {
  const env = serverEnv();
  const segmentInfo = countSegments(request.body);
  const admin = createAdminClient();

  const simulated = env.SMS_MODE !== "live" || !env.SMS_API_KEY;

  // In simulate mode the rendered body is stored so a developer can read the
  // OTP out of the log and complete the flow end to end. In live mode the body
  // is redacted for OTP traffic, because a live code must not be readable from
  // the database by anyone who can query it.
  const storedBody =
    simulated || request.kind !== "account_otp"
      ? request.body
      : "[redacted: live OTP body is not stored]";

  if (simulated) {
    const { error: logError } = await admin.from("sms_delivery_logs").insert({
      job_id: request.jobId ?? null,
      provider: env.SMS_PROVIDER,
      mode: "simulate",
      status: "simulated",
      segments: segmentInfo.segments,
      request_payload: {
        to: request.to,
        kind: request.kind,
        body: storedBody,
        note: "SIMULATED — nothing was sent to any phone.",
      },
      response_payload: null,
    });

    return {
      mode: "simulate",
      delivered: false,
      providerMessageId: null,
      segments: segmentInfo.segments,
      isUnicode: segmentInfo.isUnicode,
      logged: !logError,
      error: logError ? `could not record the simulated send: ${logError.message}` : undefined,
    };
  }

  // ---- live ---------------------------------------------------------------
  // Shaped for sms.bd's documented form-style API. The exact field names and
  // the response shape have NOT been verified against a live account, so this
  // path is unproven until the owner connects one.
  try {
    const params = new URLSearchParams({
      api_key: env.SMS_API_KEY!,
      senderid: env.SMS_SENDER_ID ?? "",
      number: request.to,
      message: request.body,
    });

    const response = await fetch(env.SMS_API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Provider returned plain text; keep it as-is for the log.
    }

    const ok = response.ok;

    const { error: logError } = await admin.from("sms_delivery_logs").insert({
      job_id: request.jobId ?? null,
      provider: env.SMS_PROVIDER,
      mode: "live",
      status: ok ? "sent" : "failed",
      error_message: ok ? null : `HTTP ${response.status}`,
      segments: segmentInfo.segments,
      // The API key is deliberately absent from what is stored.
      request_payload: {
        to: request.to,
        kind: request.kind,
        body: storedBody,
        endpoint: env.SMS_API_BASE,
      },
      response_payload: typeof parsed === "string" ? { raw: parsed } : (parsed as object),
    });

    return {
      mode: "live",
      delivered: ok,
      providerMessageId: null,
      segments: segmentInfo.segments,
      isUnicode: segmentInfo.isUnicode,
      logged: !logError,
      error: ok
        ? logError
          ? `sent, but could not be recorded: ${logError.message}`
          : undefined
        : `provider returned HTTP ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    const { error: logError } = await admin.from("sms_delivery_logs").insert({
      job_id: request.jobId ?? null,
      provider: env.SMS_PROVIDER,
      mode: "live",
      status: "failed",
      error_message: message,
      segments: segmentInfo.segments,
      request_payload: { to: request.to, kind: request.kind, endpoint: env.SMS_API_BASE },
    });

    return {
      mode: "live",
      delivered: false,
      providerMessageId: null,
      segments: segmentInfo.segments,
      isUnicode: segmentInfo.isUnicode,
      logged: !logError,
      error: message,
    };
  }
}

/** True when no provider is connected and sends are only recorded. */
export function smsIsSimulated(): boolean {
  const env = serverEnv();
  return env.SMS_MODE !== "live" || !env.SMS_API_KEY;
}
