import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import type { Route } from "next";
import { Banner } from "@/components/form";
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  NavButton,
  PageHeader,
  PageSections,
  Status,
} from "@/components/ui";
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
      <PageSections>
        <PageHeader
          title="Exams"
          meta={
            <>
              Academic year {year?.name ?? "not set"}
              {scale.data && ` · grading on the “${scale.data.name}” scale`}
            </>
          }
          actions={
            <NavButton href="/authority/grading" icon="grade">
              Grading policy
            </NavButton>
          }
        />

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

        <Card padded={false}>
          <CardHeader
            title="Exams this year"
            hint="Most recent first. An exam moves from draft to scheduled, to marks open, to published — and each step says what it allows."
          />

          {(exams.data ?? []).length === 0 ? (
            <EmptyState icon="exam" title="No exam has been created yet">
              An exam belongs to a term and holds the subjects, maximum marks and
              dates. Create one above, and teachers will see their mark sheets as
              soon as you open entry.
            </EmptyState>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line-on-white)" }}>
              {(exams.data ?? []).map((e) => {
                const status = EXAM_STATUS[e.status as ExamStatus];
                const term = one<{ name: string }>(e.terms)?.name;

                return (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/authority/exams/${e.id}` as Route}
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
                      {e.routine_published_at && (
                        <Status tone="info">routine visible</Status>
                      )}
                      <Status tone={status?.tone ?? "neutral"} dot>
                        {status?.label ?? e.status}
                      </Status>
                      <NavButton href={`/authority/exams/${e.id}` as Route}>
                        Open
                      </NavButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <CardBody className="pt-0">
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Grading bands and the pass rule are configuration, not code
              — they are set on the grading policy page and recorded into each
              published result, so changing them later never rewrites a result
              already issued.
            </p>
          </CardBody>
        </Card>
      </PageSections>
    </PortalShell>
  );
}
