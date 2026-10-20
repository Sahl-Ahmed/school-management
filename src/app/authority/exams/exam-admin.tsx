"use client";

import { useActionState, useState } from "react";
import {
  addExamSubject,
  publishExamRoutine,
  publishResults,
  setExamStatus,
  type ExamState,
} from "./actions";
import { Banner, Field, SelectField, SubmitButton } from "@/components/form";
import { EXAM_STATUS, SETTABLE_STATUSES, type ExamStatus } from "./exam-status";

const initial: ExamState = {};

type Option = { id: string; label: string };

// ---------------------------------------------------------------------------
/** Adds one subject for one class to an exam, with its own maximum. */
export function SubjectAdder({
  examId,
  classes,
  subjectsByClass,
  locked,
}: {
  examId: string;
  classes: Option[];
  /** Only the subjects a class actually studies this year. */
  subjectsByClass: Record<string, Option[]>;
  locked: boolean;
}) {
  const [state, action] = useActionState(addExamSubject, initial);

  /*
   * Every field lives in state and is submitted through hidden inputs, the
   * same pattern the attendance roster and the payment form use.
   *
   * React 19 resets a form's DOM elements once a Server Action completes, but
   * does not re-apply a controlled value afterwards. With the select named
   * directly, adding one subject left the class box visibly blank while the
   * subject list below it still showed that class's subjects — and the next
   * submission sent an empty class_id and failed with "Choose a class" for no
   * reason the user could see. Submitting from state cannot desync that way.
   */
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [maxMarks, setMaxMarks] = useState("100");
  const [passMarks, setPassMarks] = useState("");
  const [examDate, setExamDate] = useState("");

  /*
   * React empties the visible boxes after a successful add; this empties the
   * state behind them to match. Without it the boxes read blank while state
   * still held the last subject, so the next click would silently re-add it.
   * A failed submission keeps everything, which is the point of holding it in
   * state at all.
   */
  const [clearedFor, setClearedFor] = useState(0);
  if (state.ok && state.seq && state.seq !== clearedFor) {
    setClearedFor(state.seq);
    setClassId("");
    setSubjectId("");
    setMaxMarks("100");
    setPassMarks("");
    setExamDate("");
  }

  const subjects = subjectsByClass[classId] ?? [];

  // The server reports errors against the real field names; the visible
  // controls carry display names, so the messages are re-keyed to reach them.
  let errors: Record<string, string[]> | undefined;
  if (state.fieldErrors) {
    const from = state.fieldErrors;
    errors = {};
    for (const [display, real] of [
      ["class_display", "class_id"],
      ["subject_display", "subject_id"],
      ["max_marks_display", "max_marks"],
      ["pass_marks_display", "pass_marks"],
      ["exam_date_display", "exam_date"],
    ] as const) {
      const messages = from[real];
      if (messages) errors[display] = messages;
    }
  }

  return (
    <section
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-hairline)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
        <h2 className="text-sm font-semibold">Add a subject</h2>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          One row per class per subject. The maximum set here is what every mark
          is checked against and what the result sheet totals.
        </p>
      </header>

      <form action={action} className="space-y-4 p-4">
        <input type="hidden" name="exam_id" value={examId} />
        <input type="hidden" name="class_id" value={classId} />
        <input type="hidden" name="subject_id" value={subjectId} />
        <input type="hidden" name="max_marks" value={maxMarks} />
        <input type="hidden" name="pass_marks" value={passMarks} />
        <input type="hidden" name="exam_date" value={examDate} />

        {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
        {state.error && <Banner tone="error">{state.error}</Banner>}

        {locked && (
          <Banner tone="warning">
            Results are published, so the subject list is frozen. Changing it now
            would make the published totals unexplainable.
          </Banner>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {/* These carry no `name`: the hidden inputs above are the form's
              values, so a post-action DOM reset cannot change what is sent. */}
          <SelectField
            label="Class"
            name="class_display"
            errors={errors}
            required
            disabled={locked}
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              // A subject from the previous class would not be in the new
              // class's list, so it is cleared rather than silently kept.
              setSubjectId("");
            }}
          >
            <option value="">Choose a class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Subject"
            name="subject_display"
            errors={errors}
            required
            disabled={locked || !classId}
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            hint={
              classId && subjects.length === 0
                ? "That class has no subjects set for this year."
                : "Only subjects this class studies this year."
            }
          >
            <option value="">{classId ? "Choose a subject" : "Choose a class first"}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </SelectField>

          <Field
            label="Maximum marks"
            name="max_marks_display"
            type="number"
            min={1}
            max={1000}
            step="1"
            value={maxMarks}
            onChange={(e) => setMaxMarks(e.target.value)}
            errors={errors}
            required
            disabled={locked}
          />

          <Field
            label="Pass mark"
            name="pass_marks_display"
            type="number"
            min={0}
            step="1"
            value={passMarks}
            onChange={(e) => setPassMarks(e.target.value)}
            errors={errors}
            disabled={locked}
            hint="Leave blank to use the grading scale's pass percentage."
          />

          <Field
            label="Exam date"
            name="exam_date_display"
            type="date"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
            errors={errors}
            disabled={locked}
          />
        </div>

        {!locked && <SubmitButton pendingLabel="Adding…">Add subject</SubmitButton>}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
/**
 * Moves the exam through its lifecycle.
 *
 * `published` is not offered: results are published by computing them, not by
 * relabelling the exam, so there is no control here that could mark an exam
 * published with no result rows behind it.
 */
export function StatusControl({
  examId,
  current,
}: {
  examId: string;
  current: ExamStatus;
}) {
  const [state, action] = useActionState(setExamStatus, initial);

  if (current === "published") {
    return (
      <Banner tone="info">
        Results are published, so the exam is closed. Marks can still be
        corrected for the record, but a correction does not alter a sheet that
        has already gone out.
      </Banner>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="exam_id" value={examId} />

      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Stage</legend>
        <div className="space-y-1.5">
          {SETTABLE_STATUSES.map((s) => (
            <label key={s} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="status"
                value={s}
                defaultChecked={s === current}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{EXAM_STATUS[s].label}</span>
                <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                  {EXAM_STATUS[s].meaning}
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

// ---------------------------------------------------------------------------
/** Makes the exam schedule visible to students. Separate from results. */
export function RoutinePublisher({
  examId,
  publishedAt,
  subjectCount,
}: {
  examId: string;
  publishedAt: string | null;
  subjectCount: number;
}) {
  const [state, action] = useActionState(publishExamRoutine, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="exam_id" value={examId} />

      <div>
        <h3 className="text-sm font-semibold">Exam schedule</h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          Publishing the schedule shows students the dates and subjects. It
          reveals no marks.
        </p>
      </div>

      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}

      {publishedAt ? (
        <Banner tone="success">
          Visible to students since {new Date(publishedAt).toLocaleDateString("en-GB")}.
        </Banner>
      ) : subjectCount === 0 ? (
        <Banner tone="info">Add at least one subject before publishing the schedule.</Banner>
      ) : (
        <SubmitButton pendingLabel="Publishing…">Publish the schedule</SubmitButton>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
/**
 * Publishes results.
 *
 * The consequential action on this page: it freezes a sheet every parent will
 * see and cannot be undone. So it asks for the word PUBLISH to be typed, and
 * the database refuses while any mark is un-entered.
 */
export function ResultsPublisher({
  examId,
  publishedAt,
  outstanding,
  scaleName,
  passRule,
  canPublish,
}: {
  examId: string;
  publishedAt: string | null;
  outstanding: number;
  scaleName: string | null;
  passRule: string | null;
  canPublish: boolean;
}) {
  const [state, action] = useActionState(publishResults, initial);

  const ruleWords: Record<string, string> = {
    all_subjects: "a student must reach the pass mark in every subject",
    average: "a student passes on the overall percentage",
    allow_one_fail: "one failed subject is tolerated if the average passes",
  };

  if (publishedAt) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Results</h3>
        <Banner tone="success">
          Published on {new Date(publishedAt).toLocaleDateString("en-GB")}. Students
          and guardians can see their own sheets. Publishing cannot be repeated.
        </Banner>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Result SMS is a development simulation until the SMS integration phase,
          so no message has reached any phone.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="exam_id" value={examId} />

      <div>
        <h3 className="text-sm font-semibold">Publish results</h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          Computes every student&apos;s totals, grades, GPA, overall result and
          term attendance, then freezes them. This cannot be undone.
        </p>
      </div>

      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}

      {scaleName && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Scale: <strong>{scaleName}</strong>
          {passRule && ` — ${ruleWords[passRule] ?? passRule}`}.
        </p>
      )}

      {outstanding > 0 ? (
        <Banner tone="warning">
          {outstanding} subject{outstanding === 1 ? "" : "s"} still{" "}
          {outstanding === 1 ? "has" : "have"} marks outstanding. Publishing is
          refused until every mark is entered, because a partial sheet would
          total wrongly with nothing on it to show that.
        </Banner>
      ) : !canPublish ? (
        <Banner tone="info">
          Add subjects and open mark entry first. There is nothing to publish yet.
        </Banner>
      ) : (
        <>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">
              Type PUBLISH to confirm
              <span aria-hidden="true" className="ml-0.5" style={{ color: "var(--state-bad)" }}>
                *
              </span>
            </span>
            <input
              type="text"
              name="confirm"
              required
              autoComplete="off"
              placeholder="PUBLISH"
              className="w-48 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--line-hairline)", background: "var(--surface)" }}
            />
          </label>
          <SubmitButton pendingLabel="Publishing…">Publish results</SubmitButton>
        </>
      )}
    </form>
  );
}
