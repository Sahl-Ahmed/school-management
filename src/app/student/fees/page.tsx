import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "../nav";
import { Banner } from "@/components/form";
import { RingMeter, StatCard, Pill } from "@/components/charts";
import { taka, periodLabel } from "@/lib/school/money";
import { one } from "@/lib/supabase/relations";

export const metadata: Metadata = { title: "My fees" };
export const dynamic = "force-dynamic";

type Charge = {
  charge_id: string;
  fee_type: string;
  period_year: number | null;
  period_month: number | null;
  exam_name: string | null;
  amount: string;
  amount_paid: string;
  outstanding: string;
  status: string;
  due_on: string | null;
};

export default async function StudentFeesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  // RLS limits this to the caller's own record, and the RPC checks visibility
  // itself. There is no student id in the URL to change.
  const [{ data: student }, { data: year }] = await Promise.all([
    supabase.from("students").select("id, full_name, registration_no").maybeSingle(),
    supabase.from("academic_years").select("id, name").eq("is_current", true).maybeSingle(),
  ]);

  if (!student || !year) {
    return (
      <PortalShell
        portalName="Student portal"
        userName={profile?.full_name ?? "Student"}
        nav={STUDENT_NAV}
      >
        <Banner tone="error">
          Your fee record could not be loaded. Please contact the school office.
        </Banner>
      </PortalShell>
    );
  }

  const [{ data: charges }, { data: payments }] = await Promise.all([
    supabase.rpc("student_fee_summary", {
      p_student_id: student.id,
      p_academic_year_id: year.id,
    }),
    supabase
      .from("payments")
      .select("id, amount, method, paid_at, reversed_at, receipts(receipt_no)")
      .order("paid_at", { ascending: false }),
  ]);

  const rows = (charges ?? []) as Charge[];

  // Waived and cancelled charges are not money owed, so they are excluded from
  // the totals and noted separately rather than inflating what a family sees.
  const live = rows.filter((c) => c.status !== "cancelled" && c.status !== "waived");
  const billed = live.reduce((n, c) => n + Number(c.amount), 0);
  const collected = live.reduce((n, c) => n + Number(c.amount_paid), 0);
  const outstanding = live.reduce((n, c) => n + Number(c.outstanding), 0);
  const waived = rows.filter((c) => c.status === "waived");

  return (
    <PortalShell
      portalName="Student portal"
      userName={profile?.full_name ?? "Student"}
      nav={STUDENT_NAV}
    >
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">My fees</h1>
          <p className="numeric mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {student.full_name} · {student.registration_no} · academic year {year.name}
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            className="sm:col-span-2 p-4"
            style={{
              borderRadius: "var(--radius-card)",
              background: "var(--surface-raised)",
              border: "1px solid var(--line-hairline)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <RingMeter
              value={collected}
              denominator={billed}
              label="Fees cleared"
              period={`${taka(collected)} of ${taka(billed)}`}
            />
          </div>
          <StatCard
            label="Still to pay"
            value={taka(outstanding)}
            detail={`${live.filter((c) => Number(c.outstanding) > 0).length} unpaid charges`}
            tone={outstanding > 0 ? "warn" : "good"}
          />
          <StatCard
            label="Payments received"
            value={(payments ?? []).filter((p) => !p.reversed_at).length}
            detail="receipts available below"
            tone="neutral"
          />
        </section>

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
            Month by month
          </h2>

          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Nothing has been billed yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Fee charges by period</caption>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">Period</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Fee</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Paid</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr
                      key={c.charge_id}
                      style={{ borderBottom: "1px solid var(--line-hairline)" }}
                    >
                      <td className="px-4 py-2 font-medium">
                        {periodLabel(c.period_year, c.period_month, c.exam_name)}
                        {c.due_on && (
                          <span
                            className="numeric ml-2 text-xs font-normal"
                            style={{ color: "var(--text-muted)" }}
                          >
                            due {c.due_on}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                        {c.fee_type}
                      </td>
                      <td className="numeric px-3 py-2 text-right">{taka(c.amount)}</td>
                      <td className="numeric px-3 py-2 text-right">{taka(c.amount_paid)}</td>
                      <td className="px-4 py-2 text-right">
                        {c.status === "paid" && <Pill tone="good">cleared</Pill>}
                        {c.status === "partial" && (
                          <Pill tone="warn">{taka(c.outstanding)} left</Pill>
                        )}
                        {c.status === "pending" && (
                          <Pill tone="bad">{taka(c.outstanding)} due</Pill>
                        )}
                        {c.status === "waived" && <Pill tone="neutral">waived</Pill>}
                        {c.status === "cancelled" && <Pill tone="neutral">cancelled</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {waived.length > 0 && (
          <Banner tone="info">
            {waived.length} charge{waived.length === 1 ? " has" : "s have"} been
            waived by the school and {waived.length === 1 ? "is" : "are"} not
            counted in the totals above.
          </Banner>
        )}

        {(payments ?? []).length > 0 && (
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
              Receipts
            </h2>
            <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
              {(payments ?? []).map((p) => {
                const receipt = one<{ receipt_no: string }>(p.receipts);
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-sm"
                  >
                    <span className="numeric font-medium">{taka(p.amount)}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {p.method} · {p.paid_at.slice(0, 10)}
                    </span>
                    {p.reversed_at && <Pill tone="bad">reversed</Pill>}
                    {receipt?.receipt_no && !p.reversed_at && (
                      <a
                        href={`/print/receipt/${p.id}`}
                        download
                        className="numeric ml-auto text-xs underline"
                      >
                        Download {receipt.receipt_no}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </PortalShell>
  );
}
