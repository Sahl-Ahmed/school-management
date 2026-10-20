"use client";

import { useActionState, useMemo, useState } from "react";
import {
  createClassTest,
  saveClassTestMarks,
  type ClassTestState,
} from "./actions";
import { sendClassTestResult, type MarksState } from "../marks/actions";
import { Banner, Field, SelectField, SubmitButton } from "@/components/form";
import { Pill } from "@/components/charts";

const initial: ClassTestState = {};
const initialSend: MarksState = {};

export type AssignmentOption = {
  /** classId:sectionId:subjectId — the three travel together on purpose. */
  value: string;
  label: string;
};

export type TestStudent = {
  student_id: string;
  roll_no: number;
  full_name: string;
  current_marks: string | null;
  current_absent: boolean;
};

// ---------------------------------------------------------------------------
export function ClassTestCreator({
  academicYearId,
  assignments,
  today,
}: {
  academicYearId: string;
  assignments: AssignmentOption[];
  today: string;
}) {
  const [state, action] = useActionState(createClassTest, initial);

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
        <h2 className="text-sm font-semibold">Create a class test</h2>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          Your own extra test. It is separate from the school&apos;s term exams
          and does not enter a term result.
        </p>
      </header>

      <form action={action} className="space-y-4 p-4">
        <input type="hidden" name="academic_year_id" value={academicYearId} />

        {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
        {state.error && <Banner tone="error">{state.error}</Banner>}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Class and subject"
            name="assignment"
            errors={state.fieldErrors}
            required
          >
            <option value="">Choose one of your subjects</option>
            {assignments.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </SelectField>

          <Field
            label="Test name"
            name="name"
            errors={state.fieldErrors}
            required
            placeholder="Chapter 3 test"
          />

          <Field
            label="Maximum marks"
            name="max_marks"
            type="number"
            min={1}
            max={1000}
            step="1"
            defaultValue={20}
            errors={state.fieldErrors}
            required
          />

          <Field
            label="Test date"
            name="test_date"
            type="date"
            defaultValue={today}
            max={today}
            errors={state.fieldErrors}
            required
            hint="You must have been teaching that subject on this date."
          />
        </div>

        <SubmitButton pendingLabel="Creating…">Create test</SubmitButton>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
/**
 * Marks for one class test, plus the send control.
 *
 * Marks are submitted through one hidden JSON field: React 19 resets a form
 * after a Server Action, so per-row inputs cannot survive a rejected retry.
 */
export function ClassTestSheet({
  testId,
  label,
  maxMarks,
  students,
  resultSentAt,
  marksCount,
}: {
  testId: string;
  label: string;
  maxMarks: number;
  students: TestStudent[];
  resultSentAt: string | null;
  marksCount: number;
}) {
  const [state, action] = useActionState(saveClassTestMarks, initial);
  const [sendState, sendAction] = useActionState(sendClassTestResult, initialSend);

  const [marks, setMarks] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      students
        .filter((s) => s.current_marks !== null)
        .map((s) => [s.student_id, s.current_marks!]),
    ),
  );
  const [absent, setAbsent] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      students.filter((s) => s.current_absent).map((s) => [s.student_id, true]),
    ),
  );

  const entries = useMemo(
    () =>
      students
        .filter((s) => absent[s.student_id] || (marks[s.student_id] ?? "") !== "")
        .map((s) => ({
          student_id: s.student_id,
          marks: absent[s.student_id] ? null : Number(marks[s.student_id]),
          absent: Boolean(absent[s.student_id]),
        })),
    [students, marks, absent],
  );

  const sent = resultSentAt !== null;

  return (
    <section
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-hairline)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <header
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid var(--line-hairline)" }}
      >
        <div>
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="numeric mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            out of {maxMarks} · {entries.length} of {students.length} entered
          </p>
        </div>
        {sent ? <Pill tone="good">Result sent</Pill> : <Pill tone="warn">Not sent</Pill>}
      </header>

      <form action={action} className="space-y-3 p-4">
        <input type="hidden" name="class_test_id" value={testId} />
        <input type="hidden" name="max_marks" value={maxMarks} />
        <input type="hidden" name="entries" value={JSON.stringify(entries)} />

        {/* Suppressed once the result has been sent: the save notice ends with
            "nothing has been sent to guardians yet", which would sit directly
            above a sheet reading "Result sent" and contradict it. */}
        {state.ok && state.notice && !sendState.ok && (
          <Banner tone="success">{state.notice}</Banner>
        )}
        {state.error && <Banner tone="error">{state.error}</Banner>}

        {sent && (
          <Banner tone="info">
            The result for this test has already gone out, so the marks below are
            kept as a record. Correcting them will not resend anything.
          </Banner>
        )}

        <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
          {students.map((s) => {
            const isAbsent = Boolean(absent[s.student_id]);
            const value = marks[s.student_id] ?? "";
            const over = value !== "" && Number(value) > maxMarks;

            return (
              <li key={s.student_id} className="flex items-center gap-3 py-2.5">
                <span
                  className="numeric w-8 shrink-0 text-sm font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  {s.roll_no}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {s.full_name}
                </span>

                <label className="sr-only" htmlFor={`ct-${s.student_id}`}>
                  Marks for {s.full_name}, out of {maxMarks}
                </label>
                <input
                  id={`ct-${s.student_id}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={maxMarks}
                  step="0.5"
                  disabled={isAbsent}
                  value={isAbsent ? "" : value}
                  onChange={(e) => setMarks((m) => ({ ...m, [s.student_id]: e.target.value }))}
                  className="numeric w-20 shrink-0 rounded border px-2 py-1 text-right text-sm"
                  style={{
                    borderColor: over ? "var(--state-bad)" : "var(--line-hairline)",
                    background: isAbsent ? "var(--surface-sunken)" : "var(--surface)",
                  }}
                />

                <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={isAbsent}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setAbsent((a) => ({ ...a, [s.student_id]: next }));
                      if (next) {
                        setMarks((m) => {
                          const copy = { ...m };
                          delete copy[s.student_id];
                          return copy;
                        });
                      }
                    }}
                  />
                  Absent
                </label>
              </li>
            );
          })}
        </ul>

        <SubmitButton pendingLabel="Saving…">Save marks</SubmitButton>
      </form>

      {/* Sending is its own form so saving marks cannot send by accident. */}
      <div className="space-y-3 border-t p-4" style={{ borderColor: "var(--line-hairline)" }}>
        <h3 className="text-sm font-semibold">Send the result to guardians</h3>

        {sendState.ok && sendState.notice && <Banner tone="success">{sendState.notice}</Banner>}
        {sendState.error && <Banner tone="error">{sendState.error}</Banner>}

        <Banner tone="warning">
          SMS delivery is a development simulation. No provider is connected, so
          nothing reaches a phone — the system only records what it would have
          sent. Real delivery arrives in the SMS integration phase.
        </Banner>

        {sent ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Marked as sent on {new Date(resultSentAt!).toLocaleDateString("en-GB")}. It
            is not sent twice.
          </p>
        ) : marksCount === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Save the marks first. There is nothing to send yet.
          </p>
        ) : (
          <form action={sendAction}>
            <input type="hidden" name="class_test_id" value={testId} />
            <SubmitButton pendingLabel="Sending…">Send result (simulated)</SubmitButton>
          </form>
        )}
      </div>
    </section>
  );
}
