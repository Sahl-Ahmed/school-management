"use client";

import { useActionState, useMemo, useState } from "react";
import { recordPayment, reversePayment, setChargeStatus, type FeeState } from "../actions";
import { Field, SelectField, Banner, SubmitButton } from "@/components/form";
import { Pill } from "@/components/charts";
import { taka, periodLabel } from "@/lib/school/money";

export type Charge = {
  charge_id: string;
  fee_type: string;
  fee_code: string;
  period_year: number | null;
  period_month: number | null;
  exam_name: string | null;
  amount: string;
  amount_paid: string;
  discount: string;
  outstanding: string;
  status: string;
  due_on: string | null;
};

export type PaymentRow = {
  id: string;
  amount: string;
  method: string;
  paid_at: string;
  reference_no: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  receipt_no: string | null;
};

const initial: FeeState = {};

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
  { value: "rocket", label: "Rocket" },
  { value: "bank", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

export function PaymentPanel({
  studentId,
  charges,
  payments,
  isAdmin,
  /** Generated server-side per render, so a double click is a no-op. */
  paymentId,
}: {
  studentId: string;
  charges: Charge[];
  payments: PaymentRow[];
  isAdmin: boolean;
  paymentId: string;
}) {
  const [state, action] = useActionState(recordPayment, initial);
  const [reverseState, reverseAction] = useActionState(reversePayment, initial);
  const [statusState, statusAction] = useActionState(setChargeStatus, initial);

  const payable = useMemo(
    () => charges.filter((c) => c.status === "pending" || c.status === "partial"),
    [charges],
  );

  /** charge_id -> amount to settle. Oldest first is what offices actually do. */
  const [selected, setSelected] = useState<Record<string, string>>({});

  const allocations = useMemo(
    () =>
      Object.entries(selected)
        .filter(([, v]) => Number(v) > 0)
        .map(([charge_id, v]) => ({ charge_id, amount: Number(v) })),
    [selected],
  );

  const allocated = allocations.reduce((n, a) => n + a.amount, 0);

  function toggle(charge: Charge) {
    setSelected((s) => {
      const next = { ...s };
      if (next[charge.charge_id]) delete next[charge.charge_id];
      else next[charge.charge_id] = charge.outstanding;
      return next;
    });
  }

  function selectOldest(count: number) {
    const next: Record<string, string> = {};
    for (const c of payable.slice(0, count)) next[c.charge_id] = c.outstanding;
    setSelected(next);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* ------------------------- charges ------------------------- */}
      <section
        className="lg:col-span-3 overflow-hidden"
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
          Charges
          <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
            {payable.length} outstanding of {charges.length}
          </span>
        </h2>

        {statusState.error && (
          <div className="p-4 pb-0"><Banner tone="error">{statusState.error}</Banner></div>
        )}
        {statusState.ok && statusState.notice && (
          <div className="p-4 pb-0"><Banner tone="success">{statusState.notice}</Banner></div>
        )}

        {charges.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Nothing billed to this student yet.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
            {charges.map((c) => {
              const isPayable = c.status === "pending" || c.status === "partial";
              const checked = Boolean(selected[c.charge_id]);

              return (
                <li key={c.charge_id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {isPayable ? (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(c)}
                        aria-label={`Settle ${c.fee_type} for ${periodLabel(c.period_year, c.period_month, c.exam_name)}`}
                        className="shrink-0"
                      />
                    ) : (
                      <span className="w-[13px] shrink-0" aria-hidden="true" />
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {periodLabel(c.period_year, c.period_month, c.exam_name)}
                      </span>
                      <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                        {c.fee_type}
                        {c.due_on && ` · due ${c.due_on}`}
                      </span>
                    </span>

                    <span className="numeric shrink-0 text-right text-sm">
                      <span className="block">{taka(c.amount)}</span>
                      {Number(c.amount_paid) > 0 && (
                        <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                          {taka(c.amount_paid)} paid
                        </span>
                      )}
                    </span>

                    <span className="shrink-0">
                      {c.status === "paid" && <Pill tone="good">paid</Pill>}
                      {c.status === "partial" && <Pill tone="warn">{taka(c.outstanding)} left</Pill>}
                      {c.status === "pending" && <Pill tone="bad">{taka(c.outstanding)}</Pill>}
                      {c.status === "waived" && <Pill tone="neutral">waived</Pill>}
                      {c.status === "cancelled" && <Pill tone="neutral">cancelled</Pill>}
                    </span>
                  </div>

                  {/* Waiving is an administrator decision and always audited. */}
                  {isAdmin && c.status === "pending" && Number(c.amount_paid) === 0 && (
                    <form action={statusAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="charge_id" value={c.charge_id} />
                      <input type="hidden" name="student_id" value={studentId} />
                      <input type="hidden" name="status" value="waived" />
                      <input
                        type="text"
                        name="reason"
                        required
                        minLength={5}
                        placeholder="Reason for waiving this charge"
                        aria-label={`Reason for waiving ${c.fee_type}`}
                        className="min-w-[14rem] flex-1 rounded border px-2 py-1 text-xs"
                        style={{ borderColor: "var(--line-hairline)", background: "var(--surface)" }}
                      />
                      <button
                        type="submit"
                        className="rounded border px-2.5 py-1.5 text-xs font-medium"
                        style={{ borderColor: "var(--line-strong)" }}
                      >
                        Waive
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ------------------------- take a payment ------------------------- */}
      <section
        className="lg:col-span-2 space-y-5"
      >
        <form
          action={action}
          style={{
            borderRadius: "var(--radius-card)",
            background: "var(--surface-raised)",
            border: "1px solid var(--line-hairline)",
            boxShadow: "var(--shadow-card)",
            display: "block",
          }}
        >
          <h2
            className="px-4 py-3 text-sm font-semibold"
            style={{ borderBottom: "1px solid var(--line-hairline)" }}
          >
            Record a payment
          </h2>

          <div className="space-y-4 p-4">
            {/*
              The id is fixed for this render. Clicking twice sends the same id,
              the database sees the payment already exists, and returns the
              original receipt instead of taking the money again.
            */}
            <input type="hidden" name="payment_id" value={paymentId} />
            <input type="hidden" name="student_id" value={studentId} />
            <input type="hidden" name="allocations" value={JSON.stringify(allocations)} />

            {state.ok && state.notice && (
              <Banner tone={state.duplicate ? "warning" : "success"}>
                {state.notice}
              </Banner>
            )}
            {state.error && <Banner tone="error">{state.error}</Banner>}

            {state.ok && state.paymentId && (
              <a
                href={`/print/receipt/${state.paymentId}`}
                download
                className="block rounded-lg px-4 py-2.5 text-center text-sm font-medium"
                style={{ background: "var(--accent)", color: "var(--text-on-accent)" }}
              >
                Download receipt {state.receiptNo}
              </a>
            )}

            {payable.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Nothing outstanding. There is no charge to settle.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span style={{ color: "var(--text-muted)" }}>Quick select:</span>
                  {[1, 3, payable.length].filter((n, i, a) => a.indexOf(n) === i && n > 0).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => selectOldest(n)}
                      className="rounded border px-2 py-0.5 font-medium"
                      style={{ borderColor: "var(--line-hairline)" }}
                    >
                      {n === payable.length ? "all" : `oldest ${n}`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSelected({})}
                    className="rounded border px-2 py-0.5 font-medium"
                    style={{ borderColor: "var(--line-hairline)" }}
                  >
                    clear
                  </button>
                </div>

                <p className="numeric text-sm">
                  <span style={{ color: "var(--text-muted)" }}>Selected: </span>
                  <strong>{taka(allocated)}</strong>
                  <span style={{ color: "var(--text-muted)" }}>
                    {" "}· {allocations.length} charge{allocations.length === 1 ? "" : "s"}
                  </span>
                </p>

                <Field
                  label="Amount received"
                  name="amount"
                  type="number"
                  step="0.01"
                  min={0.01}
                  key={allocated}
                  defaultValue={allocated || ""}
                  errors={state.fieldErrors}
                  hint="May exceed the selected charges; the rest is left as credit"
                  required
                />

                <SelectField
                  label="Method"
                  name="method"
                  errors={state.fieldErrors}
                  defaultValue="cash"
                  required
                >
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </SelectField>

                <Field
                  label="Reference"
                  name="reference_no"
                  errors={state.fieldErrors}
                  hint="bKash transaction ID, cheque number — optional"
                />

                <Field label="Note" name="note" errors={state.fieldErrors} hint="Optional" />

                <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
              </>
            )}
          </div>
        </form>

        {/* ------------------------- history ------------------------- */}
        <section
          className="overflow-hidden"
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
            Payments
          </h2>

          {reverseState.error && (
            <div className="p-4 pb-0"><Banner tone="error">{reverseState.error}</Banner></div>
          )}
          {reverseState.ok && reverseState.notice && (
            <div className="p-4 pb-0"><Banner tone="success">{reverseState.notice}</Banner></div>
          )}

          {payments.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No payments recorded.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
              {payments.map((p) => (
                <li key={p.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="numeric font-medium">{taka(p.amount)}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {p.method} · {p.paid_at.slice(0, 10)}
                    </span>
                    {p.reversed_at && <Pill tone="bad">reversed</Pill>}
                    {p.receipt_no && (
                      <a
                        href={`/print/receipt/${p.id}`}
                        download
                        className="numeric ml-auto text-xs underline"
                      >
                        {p.receipt_no}
                      </a>
                    )}
                  </div>

                  {p.reversal_reason && (
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      {p.reversal_reason}
                    </p>
                  )}

                  {/* Reversing is administrator-only and never deletes. */}
                  {isAdmin && !p.reversed_at && (
                    <form action={reverseAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="payment_id" value={p.id} />
                      <input type="hidden" name="student_id" value={studentId} />
                      <input
                        type="text"
                        name="reason"
                        required
                        minLength={5}
                        placeholder="Reason for reversing"
                        aria-label={`Reason for reversing the payment of ${taka(p.amount)}`}
                        className="min-w-[12rem] flex-1 rounded border px-2 py-1 text-xs"
                        style={{ borderColor: "var(--line-hairline)", background: "var(--surface)" }}
                      />
                      <button
                        type="submit"
                        className="rounded border px-2.5 py-1.5 text-xs font-medium"
                        style={{ borderColor: "var(--line-strong)" }}
                      >
                        Reverse
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </div>
  );
}
