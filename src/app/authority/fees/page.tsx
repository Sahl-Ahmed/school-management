import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import type { Route } from "next";
import { Banner, SearchField } from "@/components/form";
import { RingMeter, StatCard } from "@/components/charts";
import {
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  FilterChips,
  PageHeader,
  PageSections,
  Status,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { ChargeGenerator, type FeeTypeOption } from "./charge-generator";
import { schoolToday, monthLabel } from "@/lib/school/calendar";
import { taka } from "@/lib/school/money";

export const metadata: Metadata = { title: "Fees" };
export const dynamic = "force-dynamic";

type Collection = {
  student_id: string;
  full_name: string;
  registration_no: string;
  class_name: string;
  section_name: string;
  roll_no: number;
  billed: number;
  collected: number;
  outstanding: number;
  unpaid_months: number;
};

export default async function FeesPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string; q?: string }>;
}) {
  const { class: classParam, q = "" } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  const [feeTypes, classes, collection] = await Promise.all([
    supabase
      .from("fee_types")
      .select("id, name, code, is_monthly, is_exam_fee")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("classes")
      .select("id, name, level_order")
      .eq("is_active", true)
      .order("level_order"),
    year
      ? supabase.rpc("fee_collection_overview", {
          p_academic_year_id: year.id,
          p_class_id: classParam || null,
        })
      : Promise.resolve({ data: [] as Collection[] }),
  ]);

  const rows = ((collection.data ?? []) as Collection[]).filter((r) => {
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return (
      r.full_name.toLowerCase().includes(term) ||
      r.registration_no.toLowerCase().includes(term)
    );
  });

  const billed = rows.reduce((n, r) => n + Number(r.billed), 0);
  const collected = rows.reduce((n, r) => n + Number(r.collected), 0);
  const outstanding = rows.reduce((n, r) => n + Number(r.outstanding), 0);
  const withArrears = rows.filter((r) => Number(r.outstanding) > 0).length;

  const activeClass = (classes.data ?? []).find((c) => c.id === classParam);

  const monthlyTypes: FeeTypeOption[] = (feeTypes.data ?? [])
    .filter((t) => t.is_monthly)
    .map((t) => ({ id: t.id, label: `${t.name} (${t.code})` }));

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          title="Fees"
          meta={`Academic year ${year?.name ?? "not set"} · figures cover the whole year to date`}
          description={
            activeClass
              ? `Filtered to ${activeClass.name}.`
              : undefined
          }
        />

        {!year && (
          <Banner tone="error">
            No academic year is marked as current, so fees cannot be billed or
            reported. Set the current year first.
          </Banner>
        )}

        {year && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <Card className="col-span-2">
                <RingMeter
                  value={collected}
                  denominator={billed}
                  label="Collected"
                  period={`${taka(collected)} of ${taka(billed)} billed`}
                  unit="%"
                />
              </Card>
              <StatCard
                label="Outstanding"
                value={taka(outstanding)}
                detail={`${withArrears} of ${rows.length} students owe something`}
                tone={outstanding > 0 ? "warn" : "good"}
                icon="money"
              />
              <StatCard
                label="Students billed"
                value={rows.length}
                detail={activeClass ? `in ${activeClass.name}` : "across all classes"}
                tone="neutral"
                icon="students"
              />
            </section>

            <ChargeGenerator
              academicYearId={year.id}
              feeTypes={monthlyTypes}
              classes={(classes.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
              defaultMonth={Number(schoolToday().slice(5, 7))}
              defaultYear={Number(schoolToday().slice(0, 4))}
              monthLabel={monthLabel(schoolToday())}
            />

            {/* Collection list, worst first — the point is who to chase. */}
            <Card padded={false}>
              <CardHeader
                title="Collection"
                hint="Most owed first, so the students to chase are at the top. Figures are for the whole academic year to date."
                actions={
                  <SearchField
                    label="Search students by name or registration number"
                    placeholder="Name or registration number"
                    defaultValue={q}
                    hidden={{ class: classParam }}
                  />
                }
              />

              <CardBody className="py-3">
                <FilterChips
                  label="Filter by class"
                  options={[
                    {
                      href: { pathname: "/authority/fees" as Route, query: { q: q || undefined } },
                      label: "All classes",
                      active: !classParam,
                    },
                    ...(classes.data ?? []).map((c) => ({
                      href: {
                        pathname: "/authority/fees" as Route,
                        query: { class: c.id, q: q || undefined },
                      },
                      label: c.name,
                      active: c.id === classParam,
                    })),
                  ]}
                />
              </CardBody>

              {rows.length === 0 ? (
                <EmptyState
                  icon="money"
                  title={
                    q
                      ? "No student matches that search"
                      : activeClass
                        ? `No student in ${activeClass.name} is billed yet`
                        : "No student is billed yet"
                  }
                >
                  {q
                    ? "Check the spelling, or search by registration number instead."
                    : "Generating monthly charges above bills every enrolled student at once, and the figures here follow from it."}
                </EmptyState>
              ) : (
                <DataTable
                  caption="Fee collection by student, most owed first"
                  head={
                    <>
                      <Th>Student</Th>
                      <Th>Class</Th>
                      <Th align="right">Billed</Th>
                      <Th align="right">Collected</Th>
                      <Th align="right">Outstanding</Th>
                      <Th align="right">Action</Th>
                    </>
                  }
                >
                  {rows.map((r) => (
                    <Tr key={r.student_id}>
                      <Td>
                        <span className="block font-medium">{r.full_name}</span>
                        <span
                          className="numeric block text-xs"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {r.registration_no} · roll {r.roll_no}
                        </span>
                      </Td>
                      <Td>
                        <span style={{ color: "var(--text-secondary)" }}>
                          {r.class_name}
                          {r.section_name && ` — ${r.section_name}`}
                        </span>
                      </Td>
                      <Td numeric>{taka(r.billed)}</Td>
                      <Td numeric>{taka(r.collected)}</Td>
                      <Td align="right">
                        {Number(r.outstanding) > 0 ? (
                          <Status tone={Number(r.unpaid_months) > 2 ? "bad" : "warn"}>
                            {taka(r.outstanding)}
                            {Number(r.unpaid_months) > 0 &&
                              ` · ${r.unpaid_months} month${Number(r.unpaid_months) === 1 ? "" : "s"}`}
                          </Status>
                        ) : (
                          <Status tone="good">clear</Status>
                        )}
                      </Td>
                      <Td align="right">
                        <Link
                          href={`/authority/fees/${r.student_id}` as Route}
                          className="text-sm font-medium"
                          style={{ color: "var(--accent)" }}
                        >
                          Take payment
                        </Link>
                      </Td>
                    </Tr>
                  ))}
                </DataTable>
              )}
            </Card>
          </>
        )}
      </PageSections>
    </PortalShell>
  );
}
