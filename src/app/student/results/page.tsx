import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "../nav";
import type { Route } from "next";
import { Banner } from "@/components/form";
import { RingMeter, StatCard } from "@/components/charts";
import {
  ButtonLink,
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
      <PageSections>
        <PageHeader
          title="My results"
          meta={
            <>
              {student?.full_name}
              {student?.registration_no && ` · ${student.registration_no}`}
              {results.length > 0 &&
                ` · ${results.length} published result${results.length === 1 ? "" : "s"}`}
            </>
          }
          actions={
            selected ? (
              /* A route handler returning a PDF, so a plain anchor. */
              <ButtonLink
                href={`/print/result/${selected.exam_id}`}
                download
                tone="primary"
                icon="chart"
              >
                Download this sheet
              </ButtonLink>
            ) : undefined
          }
        />

        {!student && (
          <Banner tone="error">
            Your account is not linked to a student record, so no result can be
            shown. The school office can fix this.
          </Banner>
        )}

        {student && results.length === 0 && (
          <Card padded={false}>
            <EmptyState icon="chart" title="No result has been published yet">
              A result appears here only after the school publishes it. Marks
              being entered or checked are private to the office, so an empty
              page does not mean your marks are missing.
            </EmptyState>
          </Card>
        )}

        {results.length > 1 && (
          <FilterChips
            label="Choose an exam"
            options={results.map((r) => ({
              href: { pathname: "/student/results" as Route, query: { exam: r.exam_id } },
              label: `${r.exam_name} · ${r.term_name}`,
              active: r.exam_id === selected?.exam_id,
            }))}
          />
        )}

        {selected && (
          <>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{selected.exam_name}</h2>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {selected.term_name} · {selected.academic_year} · published{" "}
                    {new Date(selected.published_at).toLocaleDateString("en-GB")}
                  </p>
                </div>
                <Status tone={selected.is_pass ? "good" : "bad"} dot>
                  {selected.is_pass ? "passed" : "not passed"}
                </Status>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <div className="col-span-2 self-center">
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
                  icon="grade"
                />

                <StatCard
                  label="Grade"
                  value={selected.grade ?? "—"}
                  detail={`${Number(selected.percentage)}% overall${
                    selected.position_in_class
                      ? ` · position ${selected.position_in_class} in class`
                      : ""
                  }`}
                  tone={selected.is_pass ? "info" : "bad"}
                  icon="chart"
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
            </Card>

            <Card padded={false}>
              <CardHeader
                title="Subjects"
                hint="Exactly as published. A later correction does not change this sheet, which is why it can be trusted as a record."
              />

              <DataTable
                caption="Subject-wise marks and grades"
                head={
                  <>
                    <Th>Subject</Th>
                    <Th align="right">Marks</Th>
                    <Th align="right">Out of</Th>
                    <Th align="right">Pass mark</Th>
                    <Th align="right">Grade</Th>
                    <Th align="right">Point</Th>
                  </>
                }
                foot={
                  <Tr>
                    <Td>
                      <span className="font-semibold">Total</span>
                    </Td>
                    <Td numeric>
                      <span className="font-semibold">{Number(selected.total_obtained)}</span>
                    </Td>
                    <Td numeric>
                      <span className="font-semibold">{Number(selected.total_max)}</span>
                    </Td>
                    <Td />
                    <Td align="right">
                      <span className="font-semibold">{selected.grade}</span>
                    </Td>
                    <Td numeric>
                      <span className="font-semibold">
                        {selected.gpa === null ? "—" : Number(selected.gpa).toFixed(2)}
                      </span>
                    </Td>
                  </Tr>
                }
              >
                {subjects.map((s) => (
                  <Tr key={s.subject}>
                    <Td>
                      <span className="font-medium">{s.subject}</span>
                    </Td>
                    <Td numeric>
                      {s.absent ? (
                        <span style={{ color: "var(--text-muted)" }}>absent</span>
                      ) : (
                        s.obtained
                      )}
                    </Td>
                    <Td numeric>{s.max}</Td>
                    <Td numeric>
                      <span style={{ color: "var(--text-muted)" }}>{s.pass_marks}</span>
                    </Td>
                    <Td align="right">
                      <Status tone={s.passed ? "good" : "bad"}>{s.grade ?? "—"}</Status>
                    </Td>
                    <Td numeric>{s.grade_point.toFixed(2)}</Td>
                  </Tr>
                ))}
              </DataTable>
            </Card>

            {/* Attendance over the term's own window, counted from submitted
                lessons only — the same basis as the attendance screen. */}
            <Card>
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
            </Card>

            <Card>
              <CardBody className="p-0">
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Result SMS is a development simulation: the message to your
                  guardian is written and costed but never delivered, because no
                  SMS provider is connected yet.
                </p>
              </CardBody>
            </Card>
          </>
        )}
      </PageSections>
    </PortalShell>
  );
}
