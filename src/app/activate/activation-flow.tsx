"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestCode, verifyAndSetPassword, type ActivationState } from "./actions";
import { Field, Banner, SubmitButton } from "@/components/form";

/**
 * The shared activation / password-recovery flow.
 *
 * Step 1 identifies the person and sends a code to the phone already on
 * record. Step 2 verifies the code and sets a password of their own choosing.
 *
 * When no SMS provider is connected, the notice says so plainly rather than
 * implying a message is on its way. A tester reads the code out of
 * sms_delivery_logs; it is deliberately not shown in the page, because that
 * would be a real hole if the simulate flag were ever wrong in production.
 */

const initial: ActivationState = { step: "identify" };

export function ActivationFlow({
  purpose,
  defaultRole = "student",
}: {
  purpose: "activation" | "password_reset";
  defaultRole?: "student" | "teacher";
}) {
  const [requestState, requestAction] = useActionState(requestCode, initial);
  const [completeState, completeAction] = useActionState(
    verifyAndSetPassword,
    initial,
  );

  // Once a code has been requested, the verify form takes over. A failure in
  // the verify step keeps showing the verify form so the code is not lost.
  const inCodeStep =
    requestState.step === "code" || completeState.step === "code";

  const role = completeState.role ?? requestState.role ?? defaultRole;
  const identifier = completeState.identifier ?? requestState.identifier ?? "";
  const masked = completeState.maskedPhone ?? requestState.maskedPhone;
  const simulated = completeState.simulated ?? requestState.simulated;

  if (completeState.step === "done") {
    return (
      <div className="space-y-4">
        <Banner tone="success">{completeState.notice}</Banner>
        <Link
          href="/login"
          className="inline-block rounded-lg px-4 py-2.5 text-sm font-medium text-white"
          style={{ background: "var(--color-brand-600)" }}
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  if (!inCodeStep) {
    return (
      <form action={requestAction} className="space-y-4">
        <input type="hidden" name="purpose" value={purpose} />

        {requestState.error && <Banner tone="error">{requestState.error}</Banner>}

        <div>
          <span className="mb-1.5 block text-sm font-medium">I am a</span>
          <div className="flex gap-4">
            {(["student", "teacher"] as const).map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="role"
                  value={r}
                  defaultChecked={r === role}
                  required
                />
                <span className="capitalize">{r}</span>
              </label>
            ))}
          </div>
        </div>

        <Field
          label="Registration number or employee code"
          name="identifier"
          defaultValue={identifier}
          hint="Students use their registration number; teachers use their employee code."
          required
          autoComplete="username"
        />

        <SubmitButton pendingLabel="Sending…">Send code</SubmitButton>

        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          The code goes to the phone number already on record at the school. If
          that number has changed, contact the school office — changing it
          requires office verification.
        </p>
      </form>
    );
  }

  return (
    <form action={completeAction} className="space-y-4">
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="identifier" value={identifier} />

      {simulated && (
        <Banner tone="warning">
          <strong>Development simulation.</strong> No SMS provider is connected,
          so no message was sent to any phone. The code was written to the
          delivery log only. This is not a working SMS feature.
        </Banner>
      )}

      {!simulated && masked && (
        <Banner tone="info">A code was sent to {masked}.</Banner>
      )}

      {simulated && masked && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Destination on record: {masked}
        </p>
      )}

      {completeState.error && <Banner tone="error">{completeState.error}</Banner>}

      <Field
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        required
      />

      <Field
        label="Choose a password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters. Only you will know it — the office cannot see it."
        required
      />

      <Field
        label="Confirm password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
      />

      <SubmitButton pendingLabel="Setting password…">
        {purpose === "activation" ? "Activate account" : "Set new password"}
      </SubmitButton>

      <Link
        href={purpose === "activation" ? "/activate" : "/forgot-password"}
        className="block text-center text-xs underline"
        style={{ color: "var(--text-muted)" }}
      >
        Start over with a different code
      </Link>
    </form>
  );
}
