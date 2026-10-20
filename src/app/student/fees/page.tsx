import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "../nav";
import { Banner } from "@/components/form";
import {
  ButtonLink,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  PageHeader,
  PageSections,
  Status,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { RingMeter, StatCard } from "@/components/charts";
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
      <PageSections>
        <PageHeader
          title="My fees"
          meta={
            <>
              {student.full_name} · {student.registration_no} · academic year{" "}
              {year.name}
            </>
          }
          description="The school office takes payments in person; this page is the record of what has been billed and received."
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Card className="col-span-2">
            <RingMeter
              value={collected}
              denominator={billed}
              label="Fees cleared"
              period={`${taka(collected)} of ${taka(billed)}`}
            />
          </Card>
          <StatCard
            label="Still to pay"
            value={taka(outstanding)}
            detail={`${live.filter((c) => Number(c.outstanding) > 0).length} unpaid charge${live.filter((c) => Number(c.outstanding) > 0).length === 1 ? "" : "s"}`}
            tone={outstanding > 0 ? "warn" : "good"}
            icon="money"
          />
          <StatCard
            label="Payments received"
            value={(payments ?? []).filter((p) => !p.reversed_at).length}
            detail="receipts available below"
            tone="neutral"
            icon="clipboard"
          />
        </section>

        <Card padded={false}>
          <CardHeader
            title="Month by month"
            hint="Every charge for this academic year, newest period first. A waived or cancelled charge is shown but is not money owed."
          />

          {rows.length === 0 ? (
            <EmptyState icon="money" title="Nothing has been billed yet">
              Monthly fees appear here as soon as the office generates them for
              your class. Nothing is overdue until it is billed.
            </EmptyState>
          ) : (
            <DataTable
              caption="Fee charges by period"
              head={
                <>
                  <Th>Period</Th>
                  <Th>Fee</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Paid</Th>
                  <Th align="right">Status</Th>
                </>
              }
              foot={
                <Tr>
                  <Td colSpan={2}>
                    <span className="font-semibold">Total owed</span>
                  </Td>
                  <Td numeric>
                    <span className="font-semibold">{taka(billed)}</span>
                  </Td>
                  <Td numeric>
                    <span className="font-semibold">{taka(collected)}</span>
                  </Td>
                  <Td align="right">
                    {outstanding > 0 ? (
                      <Status tone="warn">{taka(outstanding)} due</Status>
                    ) : (
                      <Status tone="good">all cleared</Status>
                    )}
                  </Td>
                </Tr>
              }
            >
              {rows.map((c) => (
                <Tr key={c.charge_id}>
                  <Td>
                    <span className="font-medium">
                      {periodLabel(c.period_year, c.period_month, c.exam_name)}
                    </span>
                    {c.due_on && (
                      <span
                        className="numeric block text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        due {c.due_on}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span style={{ color: "var(--text-secondary)" }}>{c.fee_type}</span>
                  </Td>
                  <Td numeric>{taka(c.amount)}</Td>
                  <Td numeric>{taka(c.amount_paid)}</Td>
                  <Td align="right">
                    {c.status === "paid" && <Status tone="good">cleared</Status>}
                    {c.status === "partial" && (
                      <Status tone="warn">{taka(c.outstanding)} left</Status>
                    )}
                    {c.status === "pending" && (
                      <Status tone="bad">{taka(c.outstanding)} due</Status>
                    )}
                    {c.status === "waived" && <Status tone="neutral">waived</Status>}
                    {c.status === "cancelled" && <Status tone="neutral">cancelled</Status>}
                  </Td>
                </Tr>
              ))}
            </DataTable>
          )}
        </Card>

        {waived.length > 0 && (
          <Banner tone="info">
            {waived.length} charge{waived.length === 1 ? " has" : "s have"} been
            waived by the school and {waived.length === 1 ? "is" : "are"} not
            counted in the totals above.
          </Banner>
        )}

        {(payments ?? []).length > 0 && (
          <Card padded={false}>
            <CardHeader
              title="Receipts"
              hint="Every payment the office has recorded, newest first. A reversed payment is kept on the record rather than deleted."
            />
            <ul className="divide-y" style={{ borderColor: "var(--line-on-white)" }}>
              {(payments ?? []).map((p) => {
                const receipt = one<{ receipt_no: string }>(p.receipts);
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 text-sm"
                  >
                    <span className="numeric font-semibold">{taka(p.amount)}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {p.method} · {p.paid_at.slice(0, 10)}
                    </span>
                    {p.reversed_at && <Status tone="bad">reversed</Status>}
                    {receipt?.receipt_no && !p.reversed_at && (
                      <span className="ml-auto">
                        <ButtonLink href={`/print/receipt/${p.id}`} download icon="clipboard">
                          <span className="numeric">{receipt.receipt_no}</span>
                        </ButtonLink>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </PageSections>
    </PortalShell>
  );
}
