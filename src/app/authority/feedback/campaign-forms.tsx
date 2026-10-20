"use client";

import { useActionState, useState } from "react";
import {
  createCampaign,
  generateTargets,
  setCampaignStatus,
  type CampaignState,
} from "./actions";
import { PROPOSED_QUESTIONS } from "./questions";
import { Banner, Field, SelectField, SubmitButton } from "@/components/form";

const initial: CampaignState = {};

export type TermOption = { id: string; label: string };

/**
 * Creates a feedback round with its questions.
 *
 * The questions are offered pre-filled with proposed wording in English and
 * Bangla, and are fully editable — the owner has not settled the final phrasing
 * (decision 6), so the screen must not pretend it has. They are submitted
 * through one hidden JSON field, like every other multi-row form here, because
 * React 19 clears a form after a Server Action and a rejected submission would
 * otherwise lose everything typed.
 */
export function CampaignCreator({
  academicYearId,
  terms,
}: {
  academicYearId: string;
  terms: TermOption[];
}) {
  const [state, action] = useActionState(createCampaign, initial);

  const [questions, setQuestions] = useState(
    PROPOSED_QUESTIONS.map((q) => ({ ...q })),
  );
  const [clearedFor, setClearedFor] = useState(0);

  if (state.ok && state.seq && state.seq !== clearedFor) {
    setClearedFor(state.seq);
    setQuestions(PROPOSED_QUESTIONS.map((q) => ({ ...q })));
  }

  const update = (i: number, field: "prompt" | "prompt_bn", value: string) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, [field]: value } : q)));

  return (
    <section
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-on-white)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-on-white)" }}>
        <h2 className="text-sm font-semibold">Create a feedback round</h2>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          One round per term. It starts as a draft; generate the forms, then open
          it.
        </p>
      </header>

      <form action={action} className="space-y-4 p-4">
        <input type="hidden" name="academic_year_id" value={academicYearId} />
        <input
          type="hidden"
          name="questions"
          value={JSON.stringify(
            questions.filter((q) => q.prompt.trim().length > 0),
          )}
        />

        {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
        {state.error && <Banner tone="error">{state.error}</Banner>}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Term" name="term_id" errors={state.fieldErrors} required>
            <option value="">Choose a term</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </SelectField>

          <Field
            label="Round name"
            name="name"
            errors={state.fieldErrors}
            required
            placeholder="Second Term teacher feedback"
          />

          <Field
            label="Opens"
            name="opens_at"
            type="datetime-local"
            errors={state.fieldErrors}
            hint="Leave blank to control it with the status alone."
          />
          <Field
            label="Closes"
            name="closes_at"
            type="datetime-local"
            errors={state.fieldErrors}
          />

          <Field
            label="Minimum lessons taught"
            name="min_periods_taught"
            type="number"
            min={0}
            max={200}
            defaultValue={1}
            errors={state.fieldErrors}
            hint="A teacher below this is not reviewed. Counts submitted lessons only."
          />

          <SelectField
            label="Rating scale"
            name="scale_max"
            errors={state.fieldErrors}
            defaultValue="5"
            hint="The owner has not fixed this; 1–5 is the current default."
          >
            <option value="5">1 to 5</option>
            <option value="10">1 to 10</option>
            <option value="4">1 to 4</option>
            <option value="3">1 to 3</option>
          </SelectField>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" name="blocks_admit_card" defaultChecked className="mt-1" />
          <span>
            <span className="font-medium">
              Incomplete feedback blocks the admit card
            </span>
            <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
              The brief&apos;s default. Students who have not finished cannot be
              issued a card for this term&apos;s exams, on any screen.
            </span>
          </span>
        </label>

        <fieldset
          className="p-4"
          style={{
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--line-on-white)",
          }}
        >
          <legend className="px-2 text-sm font-semibold">
            Questions
            <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
              two or three
            </span>
          </legend>
          <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
            These are proposed wording, not final. Edit them to whatever the
            school wants to ask — they are stored with the round, so a later
            round can ask something different.
          </p>

          <div className="space-y-4">
            {questions.map((q, i) => (
              <div key={i} className="space-y-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Question {i + 1}</span>
                  <input
                    type="text"
                    value={q.prompt}
                    maxLength={300}
                    onChange={(e) => update(i, "prompt", e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--line-on-white)", background: "var(--surface)" }}
                  />
                </label>
                <label className="block text-sm">
                  <span className="sr-only">Question {i + 1} in Bangla</span>
                  <input
                    type="text"
                    value={q.prompt_bn}
                    maxLength={300}
                    placeholder="Same question in Bangla"
                    onChange={(e) => update(i, "prompt_bn", e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--line-on-white)", background: "var(--surface)" }}
                  />
                </label>
                {i === 2 && (
                  <button
                    type="button"
                    onClick={() => setQuestions((qs) => qs.slice(0, 2))}
                    className="text-xs font-medium underline"
                    style={{ color: "var(--state-bad)" }}
                  >
                    Use only two questions
                  </button>
                )}
              </div>
            ))}

            {questions.length === 2 && (
              <button
                type="button"
                onClick={() =>
                  setQuestions((qs) => [...qs, { prompt: "", prompt_bn: "" }])
                }
                className="text-xs font-medium underline"
              >
                Add a third question
              </button>
            )}
          </div>
        </fieldset>

        <SubmitButton pendingLabel="Creating…">Create draft round</SubmitButton>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
export function TargetGenerator({
  campaignId,
  formCount,
}: {
  campaignId: string;
  formCount: number;
}) {
  const [state, action] = useActionState(generateTargets, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="campaign_id" value={campaignId} />

      <div>
        <h3 className="text-sm font-semibold">Forms</h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          Built from the assignments that overlapped the term. A teacher who
          changed mid-term and their replacement each get their own form,
          provided each taught enough lessons.
        </p>
      </div>

      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}

      <p className="numeric text-sm">
        {formCount} form{formCount === 1 ? "" : "s"} currently exist
      </p>

      <SubmitButton pendingLabel="Generating…">
        {formCount > 0 ? "Regenerate forms" : "Generate forms"}
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
const STATUSES: { value: string; label: string; meaning: string }[] = [
  { value: "draft", label: "Draft", meaning: "Students see nothing." },
  { value: "open", label: "Open", meaning: "Students can submit feedback now." },
  { value: "closed", label: "Closed", meaning: "No further feedback is accepted." },
];

export function CampaignStatusControl({
  campaignId,
  current,
}: {
  campaignId: string;
  current: string;
}) {
  const [state, action] = useActionState(setCampaignStatus, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="campaign_id" value={campaignId} />

      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Stage</legend>
        <div className="space-y-1.5">
          {STATUSES.map((s) => (
            <label key={s.value} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="status"
                value={s.value}
                defaultChecked={s.value === current}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{s.label}</span>
                <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                  {s.meaning}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton pendingLabel="Changing…">Change stage</SubmitButton>
    </form>
  );
}
