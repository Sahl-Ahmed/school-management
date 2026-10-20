import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { Banner } from "@/components/form";
import { Pill } from "@/components/charts";
import { ExamCreator, type TermOption } from "./exam-creator";
import { EXAM_STATUS, type ExamStatus } from "./exam-status";
import { one } from "@/lib/supabase/relations";
import { longDate } from "@/lib/school/calendar";

export const metadata: Metadata = { title: "Exams" };
export const dynamic = "force-dynamic";

export default async function ExamsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  const [terms, exams, scale] = await Promise.all([
    year
      ? supabase
          .from("terms")
          .select("id, name, sequence, starts_on, ends_on, attendance_window_start")
          .eq("academic_year_id", year.id)
          .order("sequence")
      : Promise.resolve({ data: [] }),
    year
      ? supabase
          .from("exams")
          .select(
            "id, name, status, starts_on, ends_on, routine_published_at, results_published_at, terms(name)",
          )
          .eq("academic_year_id", year.id)
          .order("starts_on", { ascending: false, nullsFirst: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("grading_scales")
      .select("name, subject_pass_pct, pass_rule")
      .eq("is_default", true)
      .maybeSingle(),
  ]);

  const termRows = (terms.data ?? []) as {
    id: string;
    name: string;
    sequence: number;
    starts_on: string;
    ends_on: string;
    attendance_window_start: string | null;
  }[];

  const termOptions: TermOption[] = termRows.map((t) => ({
    id: t.id,
    label: `${t.name} (${t.starts_on} to ${t.ends_on})`,
  }));

  // A term with no attendance window prints no attendance figure on its
  // results. Said plainly here rather than discovered on a published sheet.
  const windowless = termRows.filter((t) => !t.attendance_window_start);

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Exams</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Academic year {year?.name ?? "not set"}
            {scale.data && ` · grading on the "${scale.data.name}" scale`}
          </p>
        </header>

        {!year && (
          <Banner tone="error">
            No academic year is marked as current, so an exam cannot be created.
            Set the current year first.
          </Banner>
        )}

        {year && termRows.length === 0 && (
          <Banner tone="error">
            No terms exist for {year.name}. An exam belongs to a term, so add the
            terms first.
          </Banner>
        )}

        {windowless.length > 0 && (
          <Banner tone="warning">
            {windowless.map((t) => t.name).join(", ")}{" "}
            {windowless.length === 1 ? "has" : "have"} no attendance window set,
            so results for {windowless.length === 1 ? "that term" : "those terms"}{" "}
            will print no attendance percentage. Set the window on the term
            before publishing.
          </Banner>
        )}

        {year && termRows.length > 0 && (
          <ExamCreator academicYearId={year.id} terms={termOptions} />
        )}

        <section
          className="overflow-hidden"
          style={{
            borderRadius: "var(--radius-card)",
            background: "var(--surface-raised)",
            border: "1px solid var(--line-hairline)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <header
            className="px-4 py-3"
            style={{ borderBottom: "1px solid var(--line-hairline)" }}
          >
            <h2 className="text-sm font-semibold">
              Exams this year
              <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
                most recent first
              </span>
            </h2>
          </header>

          {(exams.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No exams yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
              {(exams.data ?? []).map((e) => {
                const status = EXAM_STATUS[e.status as ExamStatus];
                const term = one<{ name: string }>(e.terms)?.name;

                return (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/authority/exams/${e.id}` as never}
                        className="text-sm font-semibold underline-offset-2 hover:underline"
                      >
                        {e.name}
                      </Link>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                        {term && `${term} · `}
                        {e.starts_on ? longDate(e.starts_on) : "no date set"}
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                        {status?.meaning}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {e.routine_published_at && <Pill tone="accent">Routine visible</Pill>}
                      <Pill tone={status?.tone ?? "neutral"}>{status?.label ?? e.status}</Pill>
                      <Link
                        href={`/authority/exams/${e.id}` as never}
                        className="text-sm font-medium underline"
                      >
                        Open
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Grading bands and the pass rule are configuration, not code.{" "}
          <Link href={"/authority/grading" as never} className="underline">
            Review the grading policy
          </Link>
          .
        </p>
      </div>
    </PortalShell>
  );
}
