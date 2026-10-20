"use client";

import { useActionState, useState } from "react";
import {
  cancelQueued,
  queueDailyAttendance,
  queueExamResults,
  runDispatcher,
  updateTemplate,
  type QueueState,
} from "./actions";
import { Banner, SelectField, SubmitButton } from "@/components/form";
import { countSegments } from "@/lib/sms/segments";
import { PREVIEW_VALUES, renderTemplate } from "@/lib/sms/templates";

const initial: QueueState = {};

/** Every notice that follows a dispatch carries the simulation sentence. */
function Outcome({ state }: { state: QueueState }) {
  return (
    <>
      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.ok && state.detail && <Banner tone="warning">{state.detail}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}
    </>
  );
}

// ---------------------------------------------------------------------------
export function DailyAttendanceQueuer({
  today,
  enabled,
}: {
  today: string;
  enabled: boolean;
}) {
  const [state, action] = useActionState(queueDailyAttendance, initial);
  const [date, setDate] = useState(today);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="job_date" value={date} />

      <div>
        <h3 className="text-sm font-semibold">Daily attendance summary</h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          One message per student per school day. Running this twice for the same
          day queues nothing the second time.
        </p>
      </div>

      <Outcome state={state} />

      {!enabled && (
        <Banner tone="info">
          The daily summary is switched off in school settings. You can still
          queue and inspect messages here; nothing would go out automatically.
        </Banner>
      )}

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">School day</span>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--line-on-white)", background: "var(--surface)" }}
        />
      </label>

      <SubmitButton pendingLabel="Queueing…">Queue that day&apos;s summaries</SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function ResultQueuer({
  exams,
}: {
  exams: { id: string; label: string; published: boolean }[];
}) {
  const [state, action] = useActionState(queueExamResults, initial);

  const publishable = exams.filter((e) => e.published);

  return (
    <form action={action} className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Published result messages</h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          Only a published exam can be announced. One message per student,
          queued once.
        </p>
      </div>

      <Outcome state={state} />

      {publishable.length === 0 ? (
        <Banner tone="info">
          No exam has published results yet. Publish an exam&apos;s results and it
          will appear here.
        </Banner>
      ) : (
        <>
          <SelectField label="Exam" name="exam_id" required>
            <option value="">Choose a published exam</option>
            {publishable.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </SelectField>
          <SubmitButton pendingLabel="Queueing…">Queue result messages</SubmitButton>
        </>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
export function Dispatcher({ pending }: { pending: number }) {
  const [state, action] = useActionState(runDispatcher, initial);
  const [language, setLanguage] = useState<"en" | "bn">("en");

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="language" value={language} />
      <input type="hidden" name="limit" value="100" />

      <div>
        <h3 className="text-sm font-semibold">Run the dispatcher</h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          Renders each queued message, counts what it would cost, and records
          the attempt.
        </p>
      </div>

      <Outcome state={state} />

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Language</legend>
        <div className="flex gap-1.5">
          {([["en", "English"], ["bn", "Bangla"]] as const).map(([value, label]) => {
            const active = language === value;
            return (
              <label
                key={value}
                className="cursor-pointer px-3 py-1.5 text-sm font-medium"
                style={{
                  borderRadius: "var(--radius-control)",
                  background: active ? "var(--accent)" : "var(--surface)",
                  color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--line-on-white)"}`,
                }}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name="language_display"
                  checked={active}
                  onChange={() => setLanguage(value)}
                />
                {label}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Bangla is billed at 70 characters per segment against 160 for English,
          so the same message can cost roughly three times as much.
        </p>
      </fieldset>

      {pending === 0 ? (
        <Banner tone="info">Nothing is queued. Queue something above first.</Banner>
      ) : (
        <SubmitButton pendingLabel="Dispatching…">
          Dispatch {pending} queued message{pending === 1 ? "" : "s"} (simulated)
        </SubmitButton>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
export function QueueCanceller({ type, count }: { type: string; count: number }) {
  const [state, action] = useActionState(cancelQueued, initial);

  if (count === 0) return null;

  return (
    <form action={action} className="inline">
      <input type="hidden" name="type" value={type} />
      <button
        type="submit"
        className="whitespace-nowrap text-xs font-medium underline"
        style={{ color: "var(--state-bad)" }}
      >
        Cancel {count}
      </button>
      {state.error && (
        <span className="ml-2 text-xs" style={{ color: "var(--state-bad)" }}>{state.error}</span>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
export type TemplateRow = {
  id: string;
  type: string;
  language: string;
  name: string;
  body: string;
};

/**
 * Edits one message, with a live preview and a live segment count.
 *
 * The segment count is the point: a sentence added in Bangla can push a message
 * from one segment to three, tripling the bill for every guardian. Showing that
 * while the text is being written is the only moment it can change a decision.
 */
export function TemplateEditor({ template }: { template: TemplateRow }) {
  const [state, action] = useActionState(updateTemplate, initial);
  const [body, setBody] = useState(template.body);

  const rendered = renderTemplate(body, PREVIEW_VALUES);
  const info = countSegments(rendered.body);

  return (
    <form action={action} className="space-y-2 py-3">
      <input type="hidden" name="template_id" value={template.id} />
      <input type="hidden" name="body" value={body} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{template.name}</span>
        <span
          className="numeric text-xs"
          style={{ color: info.segments > 1 ? "var(--state-warn)" : "var(--text-muted)" }}
        >
          {info.segments} segment{info.segments === 1 ? "" : "s"} ·{" "}
          {rendered.body.length} characters
          {/*
            * "Bangla, 70 per segment" was wrong for a message that is plainly
            * English but contains one character outside GSM-7. Saying which it
            * is matters, because only one of the two is fixable.
            */}
          {info.isUnicode &&
            (info.forcedBy.length > 0
              ? " · 70 per segment"
              : " · Bangla, 70 per segment")}
        </span>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={900}
        className="w-full rounded-lg border px-3 py-2 text-sm"
        style={{ borderColor: "var(--line-on-white)", background: "var(--surface)" }}
        aria-label={`${template.name} message text`}
      />

      <p
        className="rounded-lg px-3 py-2 text-xs"
        style={{ background: "var(--surface-sunken)" }}
      >
        <span className="block font-medium" style={{ color: "var(--text-muted)" }}>
          Preview with sample values
        </span>
        {rendered.body}
      </p>

      {/*
        * The expensive surprise worth naming.
        *
        * One character outside GSM-7 — an em dash, a smart quote — forces the
        * whole message into UCS-2 and halves the characters per billable
        * segment. The shipped English result template had an em dash and so
        * cost twice what it needed to. A bare "2 segments" told nobody that;
        * naming the character, and the saving, lets the office fix it in a
        * second.
        */}
      {info.forcedBy.length > 0 && (
        <p
          className="rounded-lg px-3 py-2 text-xs"
          style={{ background: "var(--state-warn-soft)", color: "var(--state-warn)" }}
        >
          <strong>
            {info.forcedBy.map((ch) => `"${ch}"`).join(", ")}
          </strong>{" "}
          {info.forcedBy.length === 1 ? "is not" : "are not"} a standard SMS
          character, so this message is billed at 70 characters per segment
          instead of 160 — {info.segments} segment
          {info.segments === 1 ? "" : "s"} rather than{" "}
          {Math.max(1, Math.ceil(rendered.body.length / 160))}. Replacing{" "}
          {info.forcedBy.length === 1 ? "it" : "them"} with plain punctuation
          (a hyphen, a straight quote) costs the reader nothing and halves the
          bill.
        </p>
      )}

      {rendered.missing.length > 0 && (
        <p className="text-xs" style={{ color: "var(--state-bad)" }}>
          {rendered.missing.join(", ")} {rendered.missing.length === 1 ? "is" : "are"} not
          a value this message carries. It is left visible as{" "}
          <code>{`{${rendered.missing[0]}}`}</code> rather than blanked, so a
          broken message is obvious here instead of going out with a hole in it.
        </p>
      )}

      <Outcome state={state} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={body === template.body}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          Save
        </button>
        {body !== template.body && (
          <button
            type="button"
            onClick={() => setBody(template.body)}
            className="text-xs font-medium underline"
          >
            Undo
          </button>
        )}
      </div>
    </form>
  );
}
