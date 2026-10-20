import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../../nav";
import { Banner } from "@/components/form";
import {
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
import { EXAM_STATUS, type ExamStatus } from "../exam-status";
import {
  ResultsPublisher,
  RoutinePublisher,
  StatusControl,
  SubjectAdder,
} from "../exam-admin";
import { one } from "@/lib/supabase/relations";
import { longDate } from "@/lib/school/calendar";

export const metadata: Metadata = { title: "Exam" };
export const dynamic = "force-dynamic";

/** One row of exam_submission_progress. */
type Progress = {
  exam_subject_id: string;
  class_id: string;
  class_name: string;
  section_id: string;
  section_name: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string | null;
  teacher_name: string | null;
  roster: number;
  marks_entered: number;
  submitted_at: string | null;
};

export default async function ExamDetailPage({
  params,
}: {
  params: Promise<{ examId: string }>;
}) {
  const { examId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();

  const { data: exam } = await supabase
    .from("exams")
    .select(`
      id, name, status, starts_on, ends_on, academic_year_id, term_id,
      routine_published_at, results_published_at, grading_scale_id,
      terms(name, starts_on, ends_on, attendance_window_start, attendance_window_end),
      academic_years(name)
    `)
    .eq("id", examId)
    .maybeSingle();

  if (!exam) notFound();

  const term = one<{
    name: string;
    starts_on: string;
    ends_on: string;
    attendance_window_start: string | null;
    attendance_window_end: string | null;
  }>(exam.terms);

  const [subjects, progress, classes, classSubjects, scale] = await Promise.all([
    supabase
      .from("exam_subjects")
      .select("id, class_id, subject_id, max_marks, pass_marks, exam_date, classes(name, level_order), subjects(name, code)")
      .eq("exam_id", examId),
    supabase.rpc("exam_submission_progress", { p_exam_id: examId }),
    supabase
      .from("classes")
      .select("id, name, level_order")
      .eq("is_active", true)
      .order("level_order"),
    supabase
      .from("class_subjects")
      .select("class_id, subjects(id, name, code)")
      .eq("academic_year_id", exam.academic_year_id),
    exam.grading_scale_id
      ? supabase
          .from("grading_scales")
          .select("name, pass_rule, subject_pass_pct, fail_zeroes_gpa")
          .eq("id", exam.grading_scale_id)
          .maybeSingle()
      : supabase
          .from("grading_scales")
          .select("name, pass_rule, subject_pass_pct, fail_zeroes_gpa")
          .eq("is_default", true)
          .maybeSingle(),
  ]);

  const progressRows = (progress.data ?? []) as Progress[];

  // "Entered" counts a section as done only when every enrolled student has a
  // mark AND the teacher has submitted. A half-filled sheet is not progress.
  const complete = progressRows.filter(
    (r) => r.submitted_at !== null && Number(r.marks_entered) >= Number(r.roster),
  );
  const outstanding = progressRows.length - complete.length;

  const totalMarksDue = progressRows.reduce((n, r) => n + Number(r.roster), 0);
  const totalMarksIn = progressRows.reduce(
    (n, r) => n + Math.min(Number(r.marks_entered), Number(r.roster)),
    0,
  );

  const unassigned = progressRows.filter((r) => !r.teacher_id);

  const status = exam.status as ExamStatus;
  const locked = exam.results_published_at !== null;

  // The enum is authority_admin / authority_staff / teacher / student. Office
  // staff may prepare an exam; only an administrator may publish, which
  // publish_results also enforces for itself.
  const isAdmin = profile?.role === "authority_admin";

  // Only the subjects a class actually studies this year, so the picker cannot
  // put Physics into Class 2.
  const subjectsByClass: Record<string, { id: string; label: string }[]> = {};
  for (const row of classSubjects.data ?? []) {
    const s = one<{ id: string; name: string; code: string }>(row.subjects);
    if (!s) continue;
    (subjectsByClass[row.class_id] ??= []).push({ id: s.id, label: `${s.name} (${s.code})` });
  }
  for (const list of Object.values(subjectsByClass)) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }

  const subjectRows = (subjects.data ?? [])
    .map((s) => ({
      id: s.id,
      max_marks: s.max_marks,
      pass_marks: s.pass_marks,
      exam_date: s.exam_date,
      className: one<{ name: string; level_order: number }>(s.classes)?.name ?? "—",
      level: one<{ name: string; level_order: number }>(s.classes)?.level_order ?? 0,
      subjectName: one<{ name: string; code: string }>(s.subjects)?.name ?? "—",
    }))
    .sort((a, b) => a.level - b.level || a.subjectName.localeCompare(b.subjectName));

  const classCount = new Set(subjectRows.map((s) => s.className)).size;

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          breadcrumb={{ label: "Exams", href: "/authority/exams" }}
          title={exam.name}
          meta={
            <>
              {term?.name}
              {one<{ name: string }>(exam.academic_years)?.name &&
                ` · ${one<{ name: string }>(exam.academic_years)!.name}`}
              {exam.starts_on && ` · from ${longDate(exam.starts_on)}`}
            </>
          }
          description={EXAM_STATUS[status]?.meaning}
          actions={
            <Status tone={EXAM_STATUS[status]?.tone ?? "neutral"} dot>
              {EXAM_STATUS[status]?.label ?? exam.status}
            </Status>
          }
        />

        {!term?.attendance_window_start && (
          <Banner tone="warning">
            {term?.name ?? "This term"} has no attendance window set, so the
            published sheets will show no attendance percentage. Set the window
            on the term before publishing if it should appear.
          </Banner>
        )}

        {unassigned.length > 0 && (
          <Banner tone="warning">
            {unassigned.length} class-subject
            {unassigned.length === 1 ? " has" : "s have"} no assigned teacher, so
            nobody can enter those marks. Assign a teacher through the class
            routine first.
          </Banner>
        )}

        {/* Real figures only: both of these are counts of rows that exist. */}
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Card className="col-span-2">
            <RingMeter
              value={totalMarksIn}
              denominator={totalMarksDue}
              label="Marks entered"
              period={`${totalMarksIn} of ${totalMarksDue} student-subject marks`}
            />
          </Card>
          <StatCard
            label="Subjects submitted"
            value={`${complete.length} / ${progressRows.length}`}
            detail="a section counts only when every student has a mark"
            tone={outstanding === 0 && progressRows.length > 0 ? "good" : "warn"}
            icon="check"
          />
          <StatCard
            label="Subjects configured"
            value={subjectRows.length}
            detail={`across ${classCount} class${classCount === 1 ? "" : "es"}`}
            tone="neutral"
            icon="exam"
          />
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="space-y-5">
            <StatusControl examId={exam.id} current={status} />
            <hr style={{ borderColor: "var(--line-on-white)" }} />
            <RoutinePublisher
              examId={exam.id}
              publishedAt={exam.routine_published_at}
              subjectCount={subjectRows.length}
            />
          </Card>

          <Card>
            <ResultsPublisher
              examId={exam.id}
              publishedAt={exam.results_published_at}
              outstanding={outstanding}
              scaleName={scale.data?.name ?? null}
              passRule={scale.data?.pass_rule ?? null}
              canPublish={subjectRows.length > 0 && isAdmin}
            />
            {!isAdmin && !exam.results_published_at && (
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Only a school administrator can publish results. You can prepare
                everything else.
              </p>
            )}
          </Card>
        </div>

        {/* Submission tracking: who has entered marks and who has not. */}
        <Card padded={false}>
          <CardHeader
            title="Mark submission"
            hint={
              <>
                Outstanding first. &ldquo;Not submitted&rdquo; means the teacher
                has not finished — it is not a claim about any student.
              </>
            }
          />

          {progressRows.length === 0 ? (
            <EmptyState icon="exam" title="No subject is configured for this exam yet">
              Add the classes and subjects below. Mark entry, submission tracking
              and publishing all follow from that list.
            </EmptyState>
          ) : (
            <DataTable
              caption="Mark entry progress by class, section and subject"
              head={
                <>
                  <Th>Class</Th>
                  <Th>Subject</Th>
                  <Th>Teacher</Th>
                  <Th align="right">Marks in</Th>
                  <Th align="right">State</Th>
                </>
              }
            >
              {[...progressRows]
                    .sort((a, b) => {
                      const aDone = a.submitted_at !== null ? 1 : 0;
                      const bDone = b.submitted_at !== null ? 1 : 0;
                      return (
                        aDone - bDone ||
                        a.class_name.localeCompare(b.class_name) ||
                        a.subject_name.localeCompare(b.subject_name)
                      );
                    })
                .map((r) => {
                  const full = Number(r.marks_entered) >= Number(r.roster);
                  const done = r.submitted_at !== null && full;

                  return (
                    <Tr key={`${r.exam_subject_id}-${r.section_id}`}>
                      <Td>
                        {r.class_name}
                        {r.section_name && ` — ${r.section_name}`}
                      </Td>
                      <Td>
                        <span className="font-medium">{r.subject_name}</span>
                      </Td>
                      <Td>
                        {r.teacher_name ? (
                          <span style={{ color: "var(--text-secondary)" }}>
                            {r.teacher_name}
                          </span>
                        ) : (
                          <span style={{ color: "var(--state-bad)" }}>none assigned</span>
                        )}
                      </Td>
                      <Td numeric>
                        {Number(r.marks_entered)} / {Number(r.roster)}
                      </Td>
                      <Td align="right">
                        {done ? (
                          <Status tone="good">submitted</Status>
                        ) : r.submitted_at !== null ? (
                          <Status tone="warn">submitted, incomplete</Status>
                        ) : Number(r.marks_entered) > 0 ? (
                          <Status tone="warn" dot>
                            in progress
                          </Status>
                        ) : (
                          <Status tone="bad" dot>
                            not submitted
                          </Status>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
            </DataTable>
          )}
        </Card>

        <SubjectAdder
          examId={exam.id}
          classes={(classes.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
          subjectsByClass={subjectsByClass}
          locked={locked}
        />

        <Card padded={false}>
          <CardHeader
            title="Subjects in this exam"
            hint="One row per class and subject. Each carries its own maximum, and a pass mark that falls back to the grading scale when it is left blank."
          />

          {subjectRows.length === 0 ? (
            <EmptyState icon="exam" title="No subject has been added yet">
              Add a class and its subjects above. Nothing can be marked or
              published until at least one subject exists.
            </EmptyState>
          ) : (
            <DataTable
              caption="Configured exam subjects"
              head={
                <>
                  <Th>Class</Th>
                  <Th>Subject</Th>
                  <Th align="right">Out of</Th>
                  <Th align="right">Pass mark</Th>
                  <Th>Date</Th>
                </>
              }
            >
              {subjectRows.map((s) => (
                <Tr key={s.id}>
                  <Td>{s.className}</Td>
                  <Td>
                    <span className="font-medium">{s.subjectName}</span>
                  </Td>
                  <Td numeric>{Number(s.max_marks)}</Td>
                  <Td numeric>
                    {s.pass_marks === null ? (
                      <span style={{ color: "var(--text-muted)" }}>
                        {scale.data ? `${Number(scale.data.subject_pass_pct)}% of max` : "scale"}
                      </span>
                    ) : (
                      Number(s.pass_marks)
                    )}
                  </Td>
                  <Td numeric align="left">
                    {s.exam_date ?? "—"}
                  </Td>
                </Tr>
              ))}
            </DataTable>
          )}
        </Card>
      </PageSections>
    </PortalShell>
  );
}
