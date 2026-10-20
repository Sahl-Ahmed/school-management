"use client";

import { useActionState, useState } from "react";
import {
  configureAdmitRule,
  issueAdmitCard,
  issueIdCard,
  overrideAdmitCard,
  revokeIdCard,
  type CardState,
} from "./actions";
import { useFormStatus } from "react-dom";
import { Banner, SubmitButton } from "@/components/form";

const initial: CardState = {};

/**
 * A compact submit button for a row action.
 *
 * Reads its own form's pending state through useFormStatus, the same mechanism
 * SubmitButton uses, so each row disables only itself while its own action runs
 * rather than every button in the table.
 */
function RowButton({
  children,
  pendingLabel,
  tone = "accent",
}: {
  children: React.ReactNode;
  pendingLabel: string;
  tone?: "accent" | "bad" | "plain";
}) {
  const { pending } = useFormStatus();

  const style =
    tone === "accent"
      ? { background: "var(--accent)", color: "var(--text-on-accent)", border: "none" }
      : tone === "bad"
        ? { background: "transparent", color: "var(--state-bad)", border: "1px solid var(--state-bad)" }
        : { background: "transparent", color: "var(--text-primary)", border: "1px solid var(--line-strong)" };

  return (
    <button
      type="submit"
      disabled={pending}
      className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-60"
      style={style}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

// ---------------------------------------------------------------------------
export function AdmitRuleConfigurator({
  examId,
  hasRule,
  rule,
}: {
  examId: string;
  hasRule: boolean;
  rule: {
    require_feedback: boolean;
    require_fees_cleared: boolean;
    fees_cleared_through_year: number | null;
    fees_cleared_through_month: number | null;
    require_exam_fee_paid: boolean;
    allowed_outstanding: string;
    allow_override: boolean;
  } | null;
}) {
  const [state, action] = useActionState(configureAdmitRule, initial);

  const months = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="exam_id" value={examId} />

      <div>
        <h3 className="text-sm font-semibold">Admit card rules</h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          Enforced by the database, so no screen can issue a card that breaks
          them.
        </p>
      </div>

      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}

      {hasRule && rule ? (
        <ul className="space-y-1.5 text-sm">
          <li>
            {rule.require_feedback ? "✓" : "—"} Teacher feedback must be complete
          </li>
          <li>
            {rule.require_fees_cleared ? "✓" : "—"} Monthly fees clear through{" "}
            <strong>
              {rule.fees_cleared_through_month
                ? `${months[rule.fees_cleared_through_month]} ${rule.fees_cleared_through_year}`
                : "not set"}
            </strong>
          </li>
          <li>{rule.require_exam_fee_paid ? "✓" : "—"} The exam fee must be paid</li>
          <li style={{ color: "var(--text-muted)" }}>
            Tolerated outstanding: {Number(rule.allowed_outstanding)}
          </li>
          <li style={{ color: rule.allow_override ? "var(--state-warn)" : "var(--text-muted)" }}>
            Exceptions: {rule.allow_override ? "ALLOWED (audited)" : "off"}
          </li>
        </ul>
      ) : (
        <>
          <Banner tone="error">
            No rule is configured, so every admit card for this exam is blocked.
            That is the safe default, not a bug — nothing is asserted to be
            satisfied until the rule exists.
          </Banner>
          <SubmitButton pendingLabel="Setting…">Set the standard rule</SubmitButton>
        </>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
export function AdmitCardIssuer({
  examId,
  studentId,
  eligible,
  issuedAt,
}: {
  examId: string;
  studentId: string;
  eligible: boolean;
  issuedAt: string | null;
}) {
  const [state, action] = useActionState(issueAdmitCard, initial);

  return (
    <div className="space-y-1">
      <form action={action} className="inline">
        <input type="hidden" name="exam_id" value={examId} />
        <input type="hidden" name="student_id" value={studentId} />
        {eligible && (
          <RowButton pendingLabel="Issuing…">
            {issuedAt ? "Re-issue" : "Issue"}
          </RowButton>
        )}
      </form>

      {state.ok && state.notice && (
        <p className="text-xs" style={{ color: "var(--state-good)" }}>{state.notice}</p>
      )}
      {state.error && (
        <p className="text-xs" style={{ color: "var(--state-bad)" }}>{state.error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function OverrideForm({
  examId,
  studentId,
  studentName,
  allowed,
}: {
  examId: string;
  studentId: string;
  studentName: string;
  allowed: boolean;
}) {
  const [state, action] = useActionState(overrideAdmitCard, initial);
  const [open, setOpen] = useState(false);

  if (!allowed) {
    return (
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Exceptions off
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap text-xs font-medium underline"
        style={{ color: "var(--state-warn)" }}
      >
        Record an exception
      </button>
    );
  }

  return (
    <form action={action} className="space-y-1.5">
      <input type="hidden" name="exam_id" value={examId} />
      <input type="hidden" name="student_id" value={studentId} />

      {state.ok && state.notice && (
        <p className="text-xs" style={{ color: "var(--state-good)" }}>{state.notice}</p>
      )}
      {state.error && (
        <p className="text-xs" style={{ color: "var(--state-bad)" }}>{state.error}</p>
      )}

      <label className="block">
        <span className="sr-only">Reason for {studentName}&apos;s exception</span>
        <input
          type="text"
          name="reason"
          required
          minLength={5}
          maxLength={500}
          placeholder="Reason — kept on the record"
          className="w-48 rounded border px-2 py-1 text-xs"
          style={{ borderColor: "var(--line-hairline)", background: "var(--surface)" }}
        />
      </label>
      <RowButton pendingLabel="Recording…" tone="bad">Approve exception</RowButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function IdCardIssuer({
  studentId,
  templates,
  currentTokenId,
  currentToken,
}: {
  studentId: string;
  templates: { id: string; name: string; orientation: string }[];
  currentTokenId: string | null;
  currentToken: string | null;
}) {
  const [issueState, issueAction] = useActionState(issueIdCard, initial);
  const [revokeState, revokeAction] = useActionState(revokeIdCard, initial);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");

  return (
    <div className="space-y-3">
      {issueState.ok && issueState.notice && <Banner tone="success">{issueState.notice}</Banner>}
      {issueState.error && <Banner tone="error">{issueState.error}</Banner>}
      {revokeState.ok && revokeState.notice && <Banner tone="success">{revokeState.notice}</Banner>}
      {revokeState.error && <Banner tone="error">{revokeState.error}</Banner>}

      <form action={issueAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="student_id" value={studentId} />
        <input type="hidden" name="template_id" value={templateId} />

        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium">Template</span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-sm"
            style={{ borderColor: "var(--line-hairline)", background: "var(--surface)" }}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        {currentTokenId && (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium">
              Why reissue? <span style={{ color: "var(--text-muted)" }}>(optional)</span>
            </span>
            <input
              type="text"
              name="reason"
              maxLength={500}
              placeholder="Card lost"
              className="w-40 rounded-lg border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--line-hairline)", background: "var(--surface)" }}
            />
          </label>
        )}

        <RowButton pendingLabel="Issuing…">
          {currentTokenId ? "Reissue card" : "Issue card"}
        </RowButton>
      </form>

      {currentTokenId && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <a
              href={`/print/id-card/${studentId}?side=both`}
              download
              className="font-medium underline"
            >
              Download front &amp; back
            </a>
            <a
              href={`/print/id-card/${studentId}?side=front`}
              download
              className="font-medium underline"
            >
              Front only
            </a>
            <a
              href={`/print/id-card/${studentId}?side=back`}
              download
              className="font-medium underline"
            >
              Back only
            </a>
            {currentToken && (
              <a href={`/card/${currentToken}`} className="font-medium underline">
                Public page
              </a>
            )}
          </div>

          <form action={revokeAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="token_id" value={currentTokenId} />
            <label className="block">
              <span className="mb-1 block text-xs font-medium">Revoke this card</span>
              <input
                type="text"
                name="reason"
                required
                minLength={3}
                maxLength={500}
                placeholder="Reason — kept on the record"
                className="w-48 rounded-lg border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--line-hairline)", background: "var(--surface)" }}
              />
            </label>
            <RowButton pendingLabel="Revoking…" tone="bad">Revoke</RowButton>
          </form>
        </>
      )}
    </div>
  );
}
