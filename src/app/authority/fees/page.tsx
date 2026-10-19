import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { Banner } from "@/components/form";
import { RingMeter, StatCard, Pill } from "@/components/charts";
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

  const monthlyTypes: FeeTypeOption[] = (feeTypes.data ?? [])
    .filter((t) => t.is_monthly)
    .map((t) => ({ id: t.id, label: `${t.name} (${t.code})` }));

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Fees</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Academic year {year?.name ?? "not set"} · figures cover the whole year to date
          </p>
        </header>

        {!year && (
          <Banner tone="error">
            No academic year is marked as current, so fees cannot be billed or
            reported. Set the current year first.
          </Banner>
        )}

        {year && (
          <>
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
                  label="Collected"
                  period={`${taka(collected)} of ${taka(billed)} billed`}
                  unit="%"
                />
              </div>
              <StatCard
                label="Outstanding"
                value={taka(outstanding)}
                detail={`${withArrears} of ${rows.length} students owe something`}
                tone={outstanding > 0 ? "warn" : "good"}
              />
              <StatCard
                label="Students billed"
                value={rows.length}
                detail={classParam ? "in the selected class" : "across all classes"}
                tone="neutral"
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
            <section
              className="overflow-hidden"
              style={{
                borderRadius: "var(--radius-card)",
                background: "var(--surface-raised)",
                border: "1px solid var(--line-hairline)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                style={{ borderBottom: "1px solid var(--line-hairline)" }}
              >
                <h2 className="text-sm font-semibold">
                  Collection
                  <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
                    most owed first
                  </span>
                </h2>

                <form className="flex flex-wrap gap-2" role="search">
                  {classParam && <input type="hidden" name="class" value={classParam} />}
                  <label htmlFor="q" className="sr-only">
                    Search by name or registration number
                  </label>
                  <input
                    id="q"
                    name="q"
                    defaultValue={q}
                    placeholder="Name or registration number"
                    className="rounded-lg border px-3 py-1.5 text-sm"
                    style={{
                      borderColor: "var(--line-hairline)",
                      background: "var(--surface)",
                    }}
                  />
                  <button
                    type="submit"
                    className="rounded-lg border px-3 py-1.5 text-sm font-medium"
                    style={{ borderColor: "var(--line-strong)" }}
                  >
                    Search
                  </button>
                </form>
              </div>

              <nav aria-label="Filter by class" className="overflow-x-auto px-4 py-2">
                <ul className="flex gap-1">
                  <li>
                    <Link
                      href={{ pathname: "/authority/fees", query: q ? { q } : {} }}
                      aria-current={!classParam ? "page" : undefined}
                      className="block whitespace-nowrap px-2.5 py-1 text-xs font-medium"
                      style={{
                        borderRadius: "var(--radius-data)",
                        background: !classParam ? "var(--accent)" : "transparent",
                        color: !classParam ? "var(--text-on-accent)" : "var(--text-muted)",
                      }}
                    >
                      All classes
                    </Link>
                  </li>
                  {(classes.data ?? []).map((c) => {
                    const active = c.id === classParam;
                    return (
                      <li key={c.id}>
                        <Link
                          href={{
                            pathname: "/authority/fees",
                            query: { class: c.id, ...(q ? { q } : {}) },
                          }}
                          aria-current={active ? "page" : undefined}
                          className="block whitespace-nowrap px-2.5 py-1 text-xs font-medium"
                          style={{
                            borderRadius: "var(--radius-data)",
                            background: active ? "var(--accent)" : "transparent",
                            color: active ? "var(--text-on-accent)" : "var(--text-muted)",
                          }}
                        >
                          {c.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              {rows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  {q ? "No students match that search." : "No students are billed yet."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only">Fee collection by student</caption>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                        <th scope="col" className="px-4 py-2 text-left font-semibold">Student</th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Class</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Billed</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Collected</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Outstanding</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.student_id} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                          <td className="px-4 py-2">
                            <span className="block font-medium">{r.full_name}</span>
                            <span className="numeric block text-xs" style={{ color: "var(--text-muted)" }}>
                              {r.registration_no} · roll {r.roll_no}
                            </span>
                          </td>
                          <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                            {r.class_name}
                            {r.section_name && ` — ${r.section_name}`}
                          </td>
                          <td className="numeric px-3 py-2 text-right">{taka(r.billed)}</td>
                          <td className="numeric px-3 py-2 text-right">{taka(r.collected)}</td>
                          <td className="px-3 py-2 text-right">
                            {Number(r.outstanding) > 0 ? (
                              <Pill tone={Number(r.unpaid_months) > 2 ? "bad" : "warn"}>
                                {taka(r.outstanding)}
                              </Pill>
                            ) : (
                              <Pill tone="good">clear</Pill>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Link
                              href={`/authority/fees/${r.student_id}` as never}
                              className="text-sm font-medium underline"
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </PortalShell>
  );
}
