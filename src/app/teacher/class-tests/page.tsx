import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { TEACHER_NAV } from "../nav";
import { Banner } from "@/components/form";
import {
  Card,
  EmptyState,
  PageHeader,
  PageSections,
  Status,
} from "@/components/ui";
import {
  ClassTestCreator,
  ClassTestSheet,
  type AssignmentOption,
  type TestStudent,
} from "./test-forms";
import { one } from "@/lib/supabase/relations";
import { schoolToday } from "@/lib/school/calendar";

export const metadata: Metadata = { title: "Class tests" };
export const dynamic = "force-dynamic";

export default async function ClassTestsPage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string }>;
}) {
  const { test: testParam } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const { data: year } = await supabase
    .from("academic_years").select("id, name").eq("is_current", true).maybeSingle();

  // RLS limits both of these to the calling teacher's own rows.
  const [assignments, tests] = await Promise.all([
    year
      ? supabase
          .from("teacher_assignments")
          .select("class_id, section_id, subject_id, classes(name), sections(name), subjects(name)")
          .eq("academic_year_id", year.id)
      : Promise.resolve({ data: [] }),
    supabase
      .from("class_tests")
      .select("id, name, max_marks, test_date, status, result_sent_at, classes(name), sections(name), subjects(name)")
      .order("test_date", { ascending: false }),
  ]);

  const assignmentOptions: AssignmentOption[] = (assignments.data ?? []).map((a) => ({
    value: `${a.class_id}:${a.section_id}:${a.subject_id}`,
    label: `${one<{ name: string }>(a.subjects)?.name ?? "Subject"} · ${
      one<{ name: string }>(a.classes)?.name ?? "Class"
    }${one<{ name: string }>(a.sections)?.name ? ` — ${one<{ name: string }>(a.sections)!.name}` : ""}`,
  }));

  const testRows = (tests.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    maxMarks: Number(t.max_marks),
    testDate: t.test_date as string,
    status: t.status as string,
    resultSentAt: t.result_sent_at as string | null,
    label: `${t.name} · ${one<{ name: string }>(t.subjects)?.name ?? "Subject"} · ${
      one<{ name: string }>(t.classes)?.name ?? "Class"
    }${one<{ name: string }>(t.sections)?.name ? ` — ${one<{ name: string }>(t.sections)!.name}` : ""}`,
  }));

  const selected = testRows.find((t) => t.id === testParam) ?? testRows[0];

  let roster: TestStudent[] = [];
  let marksCount = 0;

  if (selected) {
    const { data: full } = await supabase
      .from("class_tests")
      .select("section_id")
      .eq("id", selected.id)
      .maybeSingle();

    if (full) {
      const [{ data: enrolled }, { data: marks }] = await Promise.all([
        supabase
          .from("student_enrollments")
          .select("roll_no, students(id, full_name)")
          .eq("section_id", full.section_id)
          .eq("status", "active")
          .order("roll_no"),
        supabase
          .from("class_test_marks")
          .select("student_id, marks_obtained, is_absent")
          .eq("class_test_id", selected.id),
      ]);

      marksCount = (marks ?? []).length;

      const byStudent = new Map(
        (marks ?? []).map((m) => [
          m.student_id,
          { marks: m.marks_obtained as string | null, absent: m.is_absent as boolean },
        ]),
      );

      roster = (enrolled ?? []).flatMap((e) => {
        const st = one<{ id: string; full_name: string }>(e.students);
        if (!st) return [];
        const existing = byStudent.get(st.id);
        return [{
          student_id: st.id,
          roll_no: e.roll_no,
          full_name: st.full_name,
          current_marks:
            existing && existing.marks !== null ? String(Number(existing.marks)) : null,
          current_absent: existing?.absent ?? false,
        }];
      });
    }
  }

  return (
    <PortalShell
      portalName="Teacher portal"
      userName={profile?.full_name ?? "Teacher"}
      nav={TEACHER_NAV}
    >
      <PageSections>
        <PageHeader
          title="Class tests"
          meta={`Your own extra tests${year ? ` · academic year ${year.name}` : ""}`}
          description="A class test is yours, not the school&rsquo;s: it does not affect a term result, and sending its marks to guardians is a simulation until an SMS provider is connected."
        />

        {!year && (
          <Banner tone="error">
            No academic year is marked as current, so a class test cannot be
            created.
          </Banner>
        )}

        {year && assignmentOptions.length === 0 && (
          <Card padded={false}>
            <EmptyState icon="teachers" title="You have no subject assignments this year">
              There is no class for you to test until the office assigns you one,
              which it does through the class routine.
            </EmptyState>
          </Card>
        )}

        {year && assignmentOptions.length > 0 && (
          <ClassTestCreator
            academicYearId={year.id}
            assignments={assignmentOptions}
            today={schoolToday()}
          />
        )}

        {testRows.length > 0 && (
          <>
            <nav
              aria-label="Choose a class test"
              className="scroll-soft -mx-1 overflow-x-auto px-1"
            >
              <ul className="flex gap-2 pb-1">
                {testRows.map((t) => {
                  const active = t.id === selected?.id;
                  return (
                    <li key={t.id} className="shrink-0">
                      <Link
                        href={{ pathname: "/teacher/class-tests", query: { test: t.id } }}
                        aria-current={active ? "page" : undefined}
                        className={`block min-w-[11rem] whitespace-nowrap px-4 py-3 text-sm transition-colors ${active ? "on-accent" : ""}`}
                        style={{
                          borderRadius: "var(--radius-card)",
                          background: active ? "var(--accent)" : "var(--surface-raised)",
                          color: active ? "var(--text-on-accent)" : "var(--text-primary)",
                          border: `1px solid ${active ? "var(--accent)" : "var(--line-on-white)"}`,
                          boxShadow: active ? "none" : "var(--shadow-card)",
                        }}
                      >
                        <span className="numeric block text-xs opacity-75">{t.testDate}</span>
                        <span className="mt-0.5 block font-semibold">{t.name}</span>
                        <span className="mt-2 block">
                          {active ? (
                            <span className="text-xs font-medium">
                              {t.resultSentAt ? "Results sent" : "Results not sent"}
                            </span>
                          ) : t.resultSentAt ? (
                            <Status tone="good">sent</Status>
                          ) : (
                            <Status tone="warn" dot>
                              not sent
                            </Status>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {selected && (
              <ClassTestSheet
                testId={selected.id}
                label={selected.label}
                maxMarks={selected.maxMarks}
                students={roster}
                resultSentAt={selected.resultSentAt}
                marksCount={marksCount}
              />
            )}
          </>
        )}
      </PageSections>
    </PortalShell>
  );
}
