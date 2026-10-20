"use client";

import { useActionState } from "react";
import {
  deleteGradeBand,
  saveGradeBand,
  updateGradingRules,
  type GradingState,
} from "./actions";
import { Banner, Field, SelectField, SubmitButton } from "@/components/form";
import { Pill } from "@/components/charts";

const initial: GradingState = {};

export type Band = {
  id: string;
  grade: string;
  min_pct: number;
  max_pct: number;
  grade_point: number;
  is_pass: boolean;
};

export type Scale = {
  id: string;
  name: string;
  pass_rule: string;
  subject_pass_pct: number;
  fail_zeroes_gpa: boolean;
  no_gpa_below_level: number | null;
};

const RULES: { value: string; label: string; meaning: string }[] = [
  {
    value: "all_subjects",
    label: "Every subject must be passed",
    meaning:
      "A student who fails one subject does not pass the term, whatever the average.",
  },
  {
    value: "average",
    label: "Pass on the overall percentage",
    meaning: "A failed subject does not matter if the overall percentage passes.",
  },
  {
    value: "allow_one_fail",
    label: "Tolerate one failed subject",
    meaning: "One failed subject is allowed if the overall percentage passes.",
  },
];

// ---------------------------------------------------------------------------
export function RulesForm({ scale }: { scale: Scale }) {
  const [state, action] = useActionState(updateGradingRules, initial);

  return (
    <form action={action} className="space-y-4 p-4">
      <input type="hidden" name="scale_id" value={scale.id} />

      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">
          How the overall term result is decided
        </legend>
        <div className="space-y-1.5">
          {RULES.map((r) => (
            <label key={r.value} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="pass_rule"
                value={r.value}
                defaultChecked={scale.pass_rule === r.value}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{r.label}</span>
                <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                  {r.meaning}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Subject pass percentage"
          name="subject_pass_pct"
          type="number"
          min={0}
          max={100}
          step="0.01"
          defaultValue={scale.subject_pass_pct}
          errors={state.fieldErrors}
          required
          hint="Used when a subject has no pass mark of its own."
        />

        <SelectField
          label="Classes that print no GPA"
          name="no_gpa_below_level"
          errors={state.fieldErrors}
          defaultValue={scale.no_gpa_below_level ?? ""}
          hint="Marks and grades still print; only the GPA figure is left off."
        >
          <option value="">Every class prints a GPA</option>
          <option value="1">Up to the first class level</option>
          <option value="2">Up to the second class level</option>
          <option value="3">Up to the third class level</option>
          <option value="4">Up to the fourth class level</option>
          <option value="5">Up to the fifth class level</option>
        </SelectField>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="fail_zeroes_gpa"
          defaultChecked={scale.fail_zeroes_gpa}
          className="mt-1"
        />
        <span>
          <span className="font-medium">
            Print GPA 0.00 and the failing grade when a subject is failed
          </span>
          <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
            The Bangladeshi convention, applied to the GPA and the overall grade
            together so a sheet cannot read &quot;not passed&quot; beside a
            passing grade. The averaged figure and the percentage&apos;s own band
            are still kept in the result record, so nothing is lost either way.
          </span>
        </span>
      </label>

      <SubmitButton pendingLabel="Saving…">Save grading rules</SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function BandForm({ scaleId }: { scaleId: string }) {
  const [state, action] = useActionState(saveGradeBand, initial);

  return (
    <form action={action} className="space-y-4 p-4">
      <input type="hidden" name="scale_id" value={scaleId} />

      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Grade"
          name="grade"
          errors={state.fieldErrors}
          required
          placeholder="A+"
          hint="Saving an existing grade letter replaces that band."
        />
        <Field
          label="Grade point"
          name="grade_point"
          type="number"
          min={0}
          max={10}
          step="0.01"
          errors={state.fieldErrors}
          required
        />
        <Field
          label="From percentage"
          name="min_pct"
          type="number"
          min={0}
          max={100}
          step="0.01"
          errors={state.fieldErrors}
          required
        />
        <Field
          label="To percentage"
          name="max_pct"
          type="number"
          min={0}
          max={100}
          step="0.01"
          errors={state.fieldErrors}
          required
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" name="is_pass" defaultChecked />
        <span className="font-medium">This band is a pass</span>
      </label>

      <SubmitButton pendingLabel="Saving…">Save band</SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function BandList({ bands }: { bands: Band[] }) {
  const [state, action] = useActionState(deleteGradeBand, initial);

  // Gaps matter: a percentage in no band grades as blank on a result sheet.
  const sorted = [...bands].sort((a, b) => b.min_pct - a.min_pct);
  const gaps: string[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const lower = sorted[i + 1]!;
    const upper = sorted[i]!;
    if (Number(lower.max_pct) + 0.01 < Number(upper.min_pct)) {
      gaps.push(`${lower.max_pct}% to ${upper.min_pct}%`);
    }
  }
  const covered =
    sorted.length > 0 &&
    Number(sorted[0]!.max_pct) >= 100 &&
    Number(sorted[sorted.length - 1]!.min_pct) <= 0;

  return (
    <div className="space-y-3 p-4">
      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}

      {bands.length === 0 ? (
        <Banner tone="error">
          This scale has no bands, so nothing can be graded. Add them below.
        </Banner>
      ) : (
        <>
          {!covered && (
            <Banner tone="warning">
              The bands do not cover 0% to 100%. A percentage outside every band
              grades as blank on a result sheet.
            </Banner>
          )}
          {gaps.length > 0 && (
            <Banner tone="warning">
              Gap between bands: {gaps.join(", ")}. A percentage in a gap grades
              as blank.
            </Banner>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Grade bands on this scale</caption>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                  <th scope="col" className="py-2 text-left font-semibold">Grade</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">From</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">To</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Point</th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Result</th>
                  <th scope="col" className="py-2 text-right font-semibold">Remove</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((b) => (
                  <tr key={b.id} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                    <td className="py-2 font-semibold">{b.grade}</td>
                    <td className="numeric px-3 py-2 text-right">{Number(b.min_pct)}%</td>
                    <td className="numeric px-3 py-2 text-right">{Number(b.max_pct)}%</td>
                    <td className="numeric px-3 py-2 text-right">
                      {Number(b.grade_point).toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
                      <Pill tone={b.is_pass ? "good" : "bad"}>
                        {b.is_pass ? "pass" : "fail"}
                      </Pill>
                    </td>
                    <td className="py-2 text-right">
                      <form action={action}>
                        <input type="hidden" name="band_id" value={b.id} />
                        <button
                          type="submit"
                          className="text-xs font-medium underline"
                          style={{ color: "var(--state-bad)" }}
                        >
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
