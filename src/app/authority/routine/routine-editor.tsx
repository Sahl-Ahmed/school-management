"use client";

import { useActionState } from "react";
import {
  addRoutinePeriod,
  endRoutinePeriod,
  type RoutineState,
} from "./actions";
import { Field, SelectField, Banner, SubmitButton } from "@/components/form";
import { WEEKDAY_NAMES, hhmm } from "@/components/routine-grid";
import { Pill } from "@/components/charts";

export type PickerOption = { id: string; label: string };

export type ExistingPeriod = {
  id: string;
  weekday: number;
  period_no: number;
  starts_at: string;
  ends_at: string;
  subject_name: string;
  teacher_name: string;
  effective_to: string | null;
};

const initial: RoutineState = {};

export function RoutineEditor({
  academicYearId,
  sectionId,
  sectionLabel,
  subjects,
  teachers,
  teachingDays,
  defaultEffectiveFrom,
  existing,
}: {
  academicYearId: string;
  sectionId: string;
  sectionLabel: string;
  sections: PickerOption[];
  subjects: PickerOption[];
  teachers: PickerOption[];
  teachingDays: number[];
  defaultEffectiveFrom: string;
  existing: ExistingPeriod[];
}) {
  const [state, action] = useActionState(addRoutinePeriod, initial);
  const [closeState, closeAction] = useActionState(endRoutinePeriod, initial);

  const open = existing.filter((p) => !p.effective_to);

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* ---------------- add a period ---------------- */}
      <section
        className="lg:col-span-2"
        style={{
          borderRadius: "var(--radius-card)",
          background: "var(--surface-raised)",
          border: "1px solid var(--line-hairline)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <h2
          className="px-4 py-3 text-sm font-semibold"
          style={{ borderBottom: "1px solid var(--line-hairline)" }}
        >
          Add a period to {sectionLabel}
        </h2>

        <form action={action} className="space-y-4 p-4">
          <input type="hidden" name="academic_year_id" value={academicYearId} />
          <input type="hidden" name="section_id" value={sectionId} />

          {state.ok && (
            <Banner tone="success">Period added to the routine.</Banner>
          )}

          {state.error && (
            <Banner tone="error">
              {state.error}
              {state.clash && (
                <>
                  {" "}
                  <span className="mt-1 block font-normal">{state.clash}</span>
                </>
              )}
            </Banner>
          )}

          <SelectField
            label="Day"
            name="weekday"
            errors={state.fieldErrors}
            required
            defaultValue=""
          >
            <option value="" disabled>Select…</option>
            {teachingDays.map((d) => (
              <option key={d} value={d}>{WEEKDAY_NAMES[d]}</option>
            ))}
          </SelectField>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Period number"
              name="period_no"
              type="number"
              min={1}
              max={20}
              errors={state.fieldErrors}
              required
            />
            <Field
              label="Effective from"
              name="effective_from"
              type="date"
              defaultValue={defaultEffectiveFrom}
              errors={state.fieldErrors}
              hint="Earlier lessons keep their original teacher"
              required
            />
            <Field
              label="Starts at"
              name="starts_at"
              type="time"
              errors={state.fieldErrors}
              required
            />
            <Field
              label="Ends at"
              name="ends_at"
              type="time"
              errors={state.fieldErrors}
              required
            />
          </div>

          <SelectField
            label="Subject"
            name="subject_id"
            errors={state.fieldErrors}
            required
            defaultValue=""
          >
            <option value="" disabled>Select…</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </SelectField>

          <SelectField
            label="Teacher"
            name="teacher_id"
            errors={state.fieldErrors}
            required
            defaultValue=""
            hint="A teacher cannot be scheduled in two places at once"
          >
            <option value="" disabled>Select…</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </SelectField>

          <SubmitButton pendingLabel="Adding…">Add period</SubmitButton>
        </form>
      </section>

      {/* ---------------- existing periods ---------------- */}
      <section
        className="lg:col-span-3"
        style={{
          borderRadius: "var(--radius-card)",
          background: "var(--surface-raised)",
          border: "1px solid var(--line-hairline)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <h2
          className="px-4 py-3 text-sm font-semibold"
          style={{ borderBottom: "1px solid var(--line-hairline)" }}
        >
          Scheduled periods
          <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
            {open.length} active
          </span>
        </h2>

        {closeState.error && (
          <div className="p-4 pb-0">
            <Banner tone="error">{closeState.error}</Banner>
          </div>
        )}

        {existing.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing scheduled yet.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
            {existing.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {p.subject_name}
                    <span className="ml-2 font-normal" style={{ color: "var(--text-secondary)" }}>
                      {p.teacher_name}
                    </span>
                  </p>
                  <p className="numeric mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {WEEKDAY_NAMES[p.weekday]} · period {p.period_no} ·{" "}
                    {hhmm(p.starts_at)}–{hhmm(p.ends_at)}
                  </p>
                </div>

                {p.effective_to ? (
                  <Pill tone="neutral">closed {p.effective_to}</Pill>
                ) : (
                  // Closing rather than deleting: past lessons keep their
                  // original teacher, which is the point of effective dating.
                  <form action={closeAction} className="flex items-end gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                      <span className="mb-1 block">Last day</span>
                      <input
                        type="date"
                        name="effective_to"
                        required
                        className="rounded border px-2 py-1 text-xs"
                        style={{
                          borderColor: "var(--line-hairline)",
                          background: "var(--surface)",
                        }}
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded border px-2.5 py-1.5 text-xs font-medium"
                      style={{ borderColor: "var(--line-strong)" }}
                    >
                      Close
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
