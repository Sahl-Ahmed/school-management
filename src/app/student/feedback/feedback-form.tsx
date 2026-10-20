"use client";

import { useActionState, useMemo, useState } from "react";
import { submitFeedback, type FeedbackState } from "./actions";
import { Banner, SubmitButton } from "@/components/form";
import { Status } from "@/components/ui";

const initial: FeedbackState = {};

export type Question = {
  id: string;
  prompt: string;
  prompt_bn: string | null;
  order_no: number;
  scale_min: number;
  scale_max: number;
};

export type FeedbackTarget = {
  target_id: string;
  teacher_name: string;
  designation: string | null;
  subject_name: string;
  subject_name_bn: string | null;
  class_name: string;
  section_name: string | null;
  periods_taught: number;
  answered_at: string | null;
};

/**
 * One teacher's feedback form.
 *
 * Ratings live in state and are submitted through a single hidden JSON field,
 * the pattern every multi-row form here uses: React 19 resets a form once a
 * Server Action completes, so a rejected submission would otherwise clear the
 * radios the student had just set while the page still showed them chosen.
 */
export function FeedbackForm({
  campaignId,
  target,
  questions,
  commentAllowed,
}: {
  campaignId: string;
  target: FeedbackTarget;
  questions: Question[];
  commentAllowed: boolean;
}) {
  const [state, action] = useActionState(submitFeedback, initial);
  const [ratings, setRatings] = useState<Record<string, number>>({});

  const payload = useMemo(
    () =>
      questions
        .filter((q) => ratings[q.id] !== undefined)
        .map((q) => ({ question_id: q.id, rating: ratings[q.id] })),
    [questions, ratings],
  );

  const answered = target.answered_at !== null || state.ok;
  const complete = payload.length === questions.length;

  return (
    <form
      action={action}
      className="overflow-hidden"
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-on-white)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <input type="hidden" name="campaign_id" value={campaignId} />
      <input type="hidden" name="target_id" value={target.target_id} />
      <input type="hidden" name="ratings" value={JSON.stringify(payload)} />

      <header
        className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid var(--line-on-white)" }}
      >
        <div>
          <h2 className="text-sm font-semibold">{target.teacher_name}</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {target.subject_name}
            {target.subject_name_bn && ` · ${target.subject_name_bn}`}
            {" · "}
            {target.class_name}
            {target.section_name && ` — ${target.section_name}`}
          </p>
          <p className="numeric mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {target.periods_taught} submitted lesson
            {target.periods_taught === 1 ? "" : "s"} this term
          </p>
        </div>
        {answered ? <Status tone="good">Done</Status> : <Status tone="warn">To do</Status>}
      </header>

      <div className="space-y-4 p-4">
        {/*
          * The success notice is shown only until the server confirms this
          * form. Each form keeps its own action state, so after a later
          * submission revalidates the page, an earlier form would still be
          * displaying "1 form left" beside a round that is now complete.
          * Once answered_at comes back set, the "Done" pill and the shared
          * completion message above carry the news instead.
          */}
        {state.ok && state.notice && target.answered_at === null && (
          <Banner tone="success">{state.notice}</Banner>
        )}
        {state.error && <Banner tone="error">{state.error}</Banner>}

        {answered && !state.ok && (
          <Banner tone="info">
            You have already answered this one. It cannot be changed — nothing
            records which answers were yours, which is what keeps them
            anonymous.
          </Banner>
        )}

        {!answered && (
          <>
            {questions.map((q) => {
              const chosen = ratings[q.id];
              const options = Array.from(
                { length: q.scale_max - q.scale_min + 1 },
                (_, i) => q.scale_min + i,
              );

              return (
                <fieldset key={q.id}>
                  <legend className="mb-2 text-sm font-medium">
                    {q.prompt}
                    {q.prompt_bn && (
                      <span className="block text-xs font-normal" style={{ color: "var(--text-muted)" }}>
                        {q.prompt_bn}
                      </span>
                    )}
                  </legend>

                  <div className="flex flex-wrap gap-1.5">
                    {options.map((value) => {
                      const active = chosen === value;
                      return (
                        <label
                          key={value}
                          className="cursor-pointer select-none px-3 py-1.5 text-sm font-medium"
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
                            name={`display-${q.id}`}
                            value={value}
                            checked={active}
                            onChange={() => setRatings((r) => ({ ...r, [q.id]: value }))}
                          />
                          {value}
                        </label>
                      );
                    })}
                    <span
                      className="self-center pl-2 text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {q.scale_min} = poor · {q.scale_max} = excellent
                    </span>
                  </div>
                </fieldset>
              );
            })}

            {commentAllowed && (
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">
                  Anything else? <span style={{ color: "var(--text-muted)" }}>(optional)</span>
                </span>
                <textarea
                  name="comment"
                  rows={3}
                  maxLength={2000}
                  placeholder="Praise or a problem — in English or Bangla"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--line-on-white)", background: "var(--surface)" }}
                />
                <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>
                  The school office reads comments. Your teacher never does, and
                  your name is not attached to it.
                </span>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton pendingLabel="Submitting…">Submit this form</SubmitButton>
              {!complete && (
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {questions.length - payload.length} question
                  {questions.length - payload.length === 1 ? "" : "s"} left
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </form>
  );
}
