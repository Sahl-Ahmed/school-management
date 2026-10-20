import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../../nav";
import { RingMeter, StatCard } from "@/components/charts";
import { Card, PageHeader, PageSections } from "@/components/ui";
import { PaymentPanel, type Charge, type PaymentRow } from "./payment-panel";
import { one } from "@/lib/supabase/relations";
import { taka } from "@/lib/school/money";

export const metadata: Metadata = { title: "Student fees" };
export const dynamic = "force-dynamic";

export default async function StudentFeesPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();

  const isAdmin = profile?.role === "authority_admin";

  const { data: year } = await supabase
    .from("academic_years").select("id, name").eq("is_current", true).maybeSingle();

  // RLS restricts students to what this user may see, so a student id in the
  // URL that the caller has no business with simply yields nothing.
  const { data: student } = await supabase
    .from("students")
    .select("id, full_name, registration_no, student_enrollments(roll_no, classes(name), sections(name))")
    .eq("id", studentId)
    .maybeSingle();

  if (!student || !year) notFound();

  const [{ data: charges }, { data: payments }] = await Promise.all([
    supabase.rpc("student_fee_summary", {
      p_student_id: studentId,
      p_academic_year_id: year.id,
    }),
    supabase
      .from("payments")
      .select("id, amount, method, paid_at, reference_no, reversed_at, reversal_reason, receipts(receipt_no)")
      .eq("student_id", studentId)
      .order("paid_at", { ascending: false }),
  ]);

  const chargeRows = (charges ?? []) as Charge[];

  const paymentRows: PaymentRow[] = (payments ?? []).map((p) => ({
    id: p.id,
    amount: String(p.amount),
    method: p.method,
    paid_at: p.paid_at,
    reference_no: p.reference_no,
    reversed_at: p.reversed_at,
    reversal_reason: p.reversal_reason,
    receipt_no: one<{ receipt_no: string }>(p.receipts)?.receipt_no ?? null,
  }));

  // Waived and cancelled charges are excluded from "billed": they are not
  // money the school expects, so including them would make collection look
  // worse than it is.
  const live = chargeRows.filter((c) => c.status !== "cancelled" && c.status !== "waived");
  const billed = live.reduce((n, c) => n + Number(c.amount), 0);
  const collected = live.reduce((n, c) => n + Number(c.amount_paid), 0);
  const outstanding = live.reduce((n, c) => n + Number(c.outstanding), 0);

  const enrollment = one<{ roll_no: number; classes: unknown; sections: unknown }>(
    student.student_enrollments,
  );
  const cls = one<{ name: string }>(enrollment?.classes as never);
  const sec = one<{ name: string }>(enrollment?.sections as never);

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          breadcrumb={{ label: "Fees", href: "/authority/fees" }}
          title={student.full_name}
          meta={
            <>
              {student.registration_no}
              {cls?.name && ` · ${cls.name}${sec?.name ? ` — ${sec.name}` : ""}`}
              {enrollment?.roll_no && ` · roll ${enrollment.roll_no}`}
              {` · academic year ${year.name}`}
            </>
          }
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Card className="col-span-2">
            <RingMeter
              value={collected}
              denominator={billed}
              label="Fees cleared"
              period={`${taka(collected)} of ${taka(billed)} billed`}
            />
          </Card>
          <StatCard
            label="Outstanding"
            value={taka(outstanding)}
            detail={`${live.filter((c) => Number(c.outstanding) > 0).length} unpaid charge${live.filter((c) => Number(c.outstanding) > 0).length === 1 ? "" : "s"}`}
            tone={outstanding > 0 ? "warn" : "good"}
            icon="money"
          />
          <StatCard
            label="Payments"
            value={paymentRows.filter((p) => !p.reversed_at).length}
            detail={
              paymentRows.some((p) => p.reversed_at)
                ? `${paymentRows.filter((p) => p.reversed_at).length} reversed`
                : "none reversed"
            }
            tone="neutral"
            icon="clipboard"
          />
        </section>

        <PaymentPanel
          studentId={studentId}
          charges={chargeRows}
          payments={paymentRows}
          isAdmin={isAdmin}
          paymentId={randomUUID()}
        />
      </PageSections>
    </PortalShell>
  );
}
