"use client";

import { useActionState } from "react";
import { generateMonthlyCharges, type FeeState } from "./actions";
import { SelectField, Field, Banner, SubmitButton } from "@/components/form";
import { MONTHS } from "@/lib/school/money";

export type FeeTypeOption = { id: string; label: string };

const initial: FeeState = {};

/**
 * Bills a month's fees to every actively enrolled student.
 *
 * Safe to run more than once: the database refuses a second charge for the same
 * student, fee type and period, and the result says how many were skipped. That
 * matters because re-running a month is a normal thing to do after admitting a
 * late student, and an office that fears double-billing will do it by hand
 * instead.
 */
export function ChargeGenerator({
  academicYearId,
  feeTypes,
  classes,
  defaultMonth,
  defaultYear,
  monthLabel,
}: {
  academicYearId: string;
  feeTypes: FeeTypeOption[];
  classes: { id: string; label: string }[];
  defaultMonth: number;
  defaultYear: number;
  monthLabel: string;
}) {
  const [state, action] = useActionState(generateMonthlyCharges, initial);

  if (feeTypes.length === 0) {
    return (
      <Banner tone="info">
        No monthly fee type is configured, so monthly charges cannot be
        generated. Add a fee type and a rate for each class first.
      </Banner>
    );
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
      <h2
        className="px-4 py-3 text-sm font-semibold"
        style={{ borderBottom: "1px solid var(--line-hairline)" }}
      >
        Bill a month
        <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
          currently {monthLabel}
        </span>
      </h2>

      <form action={action} className="space-y-4 p-4">
        <input type="hidden" name="academic_year_id" value={academicYearId} />

        {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
        {state.error && <Banner tone="error">{state.error}</Banner>}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SelectField
            label="Fee type"
            name="fee_type_id"
            errors={state.fieldErrors}
            required
            defaultValue={feeTypes[0]?.id}
          >
            {feeTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </SelectField>

          <SelectField
            label="Month"
            name="period_month"
            errors={state.fieldErrors}
            required
            defaultValue={String(defaultMonth)}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </SelectField>

          <Field
            label="Year"
            name="period_year"
            type="number"
            min={2000}
            max={2200}
            defaultValue={defaultYear}
            errors={state.fieldErrors}
            required
          />

          <SelectField
            label="Class"
            name="class_id"
            errors={state.fieldErrors}
            defaultValue=""
            hint="Leave as all unless billing one class"
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </SelectField>

          <Field
            label="Due day"
            name="due_day"
            type="number"
            min={1}
            max={28}
            defaultValue={10}
            errors={state.fieldErrors}
            hint="Day of the month"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Billing…">Generate charges</SubmitButton>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Running this twice is safe — a student already billed for the month
            is skipped, not charged again.
          </p>
        </div>
      </form>
    </section>
  );
}
