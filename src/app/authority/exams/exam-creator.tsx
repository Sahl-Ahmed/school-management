"use client";

import { useActionState } from "react";
import { createExam, type ExamState } from "./actions";
import { Banner, Field, SelectField, SubmitButton } from "@/components/form";

const initial: ExamState = {};

export type TermOption = { id: string; label: string };

/**
 * Creates a term exam as a draft.
 *
 * A new exam is always a draft: nothing is visible to a teacher or a student
 * until the authority moves it on, so a half-configured exam cannot leak.
 */
export function ExamCreator({
  academicYearId,
  terms,
}: {
  academicYearId: string;
  terms: TermOption[];
}) {
  const [state, action] = useActionState(createExam, initial);

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
        <h2 className="text-sm font-semibold">Create a term exam</h2>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          It starts as a draft. Subjects, mark entry and publishing come after.
        </p>
      </header>

      <form action={action} className="space-y-4 p-4">
        <input type="hidden" name="academic_year_id" value={academicYearId} />

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
            label="Exam name"
            name="name"
            errors={state.fieldErrors}
            required
            placeholder="Half Yearly Examination"
            hint="As it should appear on the result sheet."
          />

          <Field label="Starts on" name="starts_on" type="date" errors={state.fieldErrors} />
          <Field label="Ends on" name="ends_on" type="date" errors={state.fieldErrors} />
        </div>

        <SubmitButton pendingLabel="Creating…">Create draft exam</SubmitButton>
      </form>
    </section>
  );
}
