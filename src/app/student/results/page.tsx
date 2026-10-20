import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "../nav";
import { Banner } from "@/components/form";
import { RingMeter, StatCard, Pill } from "@/components/charts";

export const metadata: Metadata = { title: "My results" };
export const dynamic = "force-dynamic";

/** One row of student_results. */
type Result = {
  exam_id: string;
  exam_name: string;
  term_name: string;
  academic_year: string;
  total_obtained: string;
  total_max: string;
  percentage: string;
  gpa: string | null;
  grade: string | null;
  is_pass: boolean;
  attendance_pct: string | null;
  position_in_class: number | null;
  snapshot: Snapshot;
  published_at: string;
};

type Snapshot = {
  subjects: {
    subject: string;
    obtained: number | null;
    max: number;
    pass_marks: number;
    percentage: number;
    grade: string | null;
    grade_point: number;
    absent: boolean;
    passed: boolean;
  }[];
  gpa_computed: number;
  /** The band grade for the percentage, kept when the printed grade differs. */
  grade_computed?: string | null;
  gpa_printed: number | null;
  failed_subjects: number;
  pass_rule: string;
  scale: string;
  attendance: {
    present: number;
    submitted_lessons: number;
    window_start: string | null;
    window_end: string | null;
  };
};

export default async function StudentResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string }>;
}) {
  const { exam: examParam } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  // RLS limits this to the caller's own record; there is no student id in the
  // URL that could be changed to reach someone else.
  const { data: student } = await supabase
    .from("students")
    .select("id, full_name, registration_no")
    .maybeSingle();

  // Only published results exist in this table, so a draft mark cannot appear
  // here however the page is reached.
  const { data } = student
    ? await supabase.rpc("student_results", { p_student_id: student.id })
    : { data: [] };

  const results = (data ?? []) as Result[];
  const selected = results.find((r) => r.exam_id === examParam) ?? results[0];

  const subjects = selected?.snapshot?.subjects ?? [];
  const attendance = selected?.snapshot?.attendance;

  return (
    <PortalShell
      portalName="Student portal"
      userName={profile?.full_name ?? "Student"}
      nav={STUDENT_NAV}
    >
      <div className="space-y-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">My results</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {student?.full_name}
            {student?.registration_no && ` · ${student.registration_no}`}
          </p>
        </header>

        {!student && (
          <Banner tone="error">
            Your account is not linked to a student record, so no result can be
            shown. The school office can fix this.
          </Banner>
        )}

        {student && results.length === 0 && (
          <Banner tone="info">
            No results have been published yet. A result appears here only after
            the school publishes it — marks being entered are not visible.
          </Banner>
        )}

        {results.length > 1 && (
          <nav aria-label="Choose an exam" className="overflow-x-auto">
            <ul className="flex gap-1 pb-1">
              {results.map((r) => {
                const active = r.exam_id === selected?.exam_id;
                return (
                  <li key={r.exam_id}>
                    <Link
                      href={{ pathname: "/student/results", query: { exam: r.exam_id } }}
                      aria-current={active ? "page" : undefined}
                      className="block whitespace-nowrap px-3 py-2 text-sm"
                      style={{
                        borderRadius: "var(--radius-control)",
                        background: active ? "var(--accent)" : "var(--surface-raised)",
                        color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
                        border: `1px solid ${active ? "var(--accent)" : "var(--line-hairline)"}`,
                      }}
                    >
                      <span className="block font-medium">{r.exam_name}</span>
                      <span className="block text-xs opacity-80">
                        {r.term_name} · {r.academic_year}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {selected && (
          <>
            <section
              className="p-4"
              style={{
                borderRadius: "var(--radius-card)",
                background: "var(--surface-raised)",
                border: "1px solid var(--line-hairline)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{selected.exam_name}</h2>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {selected.term_name} · {selected.academic_year} · published{" "}
                    {new Date(selected.published_at).toLocaleDateString("en-GB")}
                  </p>
                </div>
                <Pill tone={selected.is_pass ? "good" : "bad"}>
                  {selected.is_pass ? "Passed" : "Not passed"}
                </Pill>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <RingMeter
                    value={Number(selected.total_obtained)}
                    denominator={Number(selected.total_max)}
                    label="Total marks"
                    period={`${Number(selected.total_obtained)} of ${Number(selected.total_max)} across ${subjects.length} subjects`}
                  />
                </div>

                <StatCard
                  label="GPA"
                  value={selected.gpa === null ? "—" : Number(selected.gpa).toFixed(2)}
                  detail={
                    selected.gpa === null
                      ? "no GPA is printed for this class"
                      : `on the ${selected.snapshot.scale} scale`
                  }
                  tone={selected.is_pass ? "good" : "bad"}
                />

                <StatCard
                  label="Grade"
                  value={selected.grade ?? "—"}
                  detail={`${Number(selected.percentage)}% overall${
                    selected.position_in_class
                      ? ` · position ${selected.position_in_class} in class`
                      : ""
                  }`}
                  tone={selected.is_pass ? "accent" : "bad"}
                />
              </div>

              {/* A failed subject prints GPA 0.00 and the failing grade, by the
                  school's rule. Saying so here stops either figure reading as a
                  mistake, and names the percentage's own band so the sheet
                  hides nothing. */}
              {!selected.is_pass &&
                selected.gpa !== null &&
                Number(selected.gpa) === 0 &&
                selected.snapshot.gpa_computed > 0 && (
                  <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
                    GPA prints as 0.00 and the grade as {selected.grade} because{" "}
                    {selected.snapshot.failed_subjects === 1
                      ? "one subject was"
                      : `${selected.snapshot.failed_subjects} subjects were`}{" "}
                    below the pass mark. The school&apos;s rule is that every
                    subject must be passed. On the marks alone this term would
                    have averaged {selected.snapshot.gpa_computed.toFixed(2)}
                    {selected.snapshot.grade_computed &&
                      ` and sat in the ${selected.snapshot.grade_computed} band`}
                    .
                  </p>
                )}
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
              <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                <h2 className="text-sm font-semibold">Subjects</h2>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  Exactly as published. A later correction does not change this
                  sheet.
                </p>
              </header>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Subject-wise marks and grades</caption>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                      <th scope="col" className="px-4 py-2 text-left font-semibold">Subject</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Marks</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Out of</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Pass mark</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Grade</th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">Point</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map((s) => (
                      <tr key={s.subject} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                        <td className="px-4 py-2 font-medium">{s.subject}</td>
                        <td className="numeric px-3 py-2 text-right">
                          {s.absent ? (
                            <span style={{ color: "var(--text-muted)" }}>absent</span>
                          ) : (
                            s.obtained
                          )}
                        </td>
                        <td className="numeric px-3 py-2 text-right">{s.max}</td>
                        <td className="numeric px-3 py-2 text-right" style={{ color: "var(--text-muted)" }}>
                          {s.pass_marks}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Pill tone={s.passed ? "good" : "bad"}>{s.grade ?? "—"}</Pill>
                        </td>
                        <td className="numeric px-4 py-2 text-right">
                          {s.grade_point.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "1px solid var(--line-strong)" }}>
                      <th scope="row" className="px-4 py-2 text-left font-semibold">Total</th>
                      <td className="numeric px-3 py-2 text-right font-semibold">
                        {Number(selected.total_obtained)}
                      </td>
                      <td className="numeric px-3 py-2 text-right font-semibold">
                        {Number(selected.total_max)}
                      </td>
                      <td />
                      <td className="px-3 py-2 text-right font-semibold">{selected.grade}</td>
                      <td className="numeric px-4 py-2 text-right font-semibold">
                        {selected.gpa === null ? "—" : Number(selected.gpa).toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            {/* Attendance over the term's own window, counted from submitted
                lessons only — the same basis as the attendance screen. */}
            <section
              className="p-4"
              style={{
                borderRadius: "var(--radius-card)",
                background: "var(--surface-raised)",
                border: "1px solid var(--line-hairline)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <h2 className="mb-3 text-sm font-semibold">Attendance for this term</h2>

              {attendance && attendance.submitted_lessons > 0 ? (
                <>
                  <RingMeter
                    value={attendance.present}
                    denominator={attendance.submitted_lessons}
                    label="Present"
                    period={
                      attendance.window_start
                        ? `${attendance.window_start} to ${attendance.window_end ?? "term end"}`
                        : undefined
                    }
                  />
                  <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                    Counted only from lessons a teacher actually submitted. A
                    lesson with no submission is not counted against you.
                  </p>
                </>
              ) : (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  No attendance figure is printed for this term
                  {attendance && !attendance.window_start
                    ? ", because the term has no attendance window set."
                    : ", because no attendance was submitted in its window."}
                </p>
              )}
            </section>

            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Result SMS is a development simulation until the SMS integration
              phase, so no message has been sent to any phone.
            </p>
          </>
        )}
      </div>
    </PortalShell>
  );
}
