import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../../nav";
import { Banner } from "@/components/form";
import { Pill, RingMeter, StatCard } from "@/components/charts";
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
      <div className="space-y-6">
        <nav aria-label="Breadcrumb" className="text-xs">
          <Link href={"/authority/exams" as never} className="underline" style={{ color: "var(--text-muted)" }}>
            Exams
          </Link>
        </nav>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{exam.name}</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {term?.name}
              {one<{ name: string }>(exam.academic_years)?.name &&
                ` · ${one<{ name: string }>(exam.academic_years)!.name}`}
              {exam.starts_on && ` · from ${longDate(exam.starts_on)}`}
            </p>
          </div>
          <Pill tone={EXAM_STATUS[status]?.tone ?? "neutral"}>
            {EXAM_STATUS[status]?.label ?? exam.status}
          </Pill>
        </header>

        {!term?.attendance_window_start && (
          <Banner tone="warning">
            {term?.name ?? "This term"} has no attendance window set, so the
            published sheets will show no attendance percentage. Set the window
            on the term before publishing if it should appear.
          </Banner>
        )}

        {unassigned.length > 0 && (
          <Banner tone="warning">
            {unassigned.length} class-subject{unassigned.length === 1 ? "" : "s"} have
            no assigned teacher, so nobody can enter those marks. Assign a teacher
            through the class routine first.
          </Banner>
        )}

        {/* Real figures only: both of these are counts of rows that exist. */}
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
              value={totalMarksIn}
              denominator={totalMarksDue}
              label="Marks entered"
              period={`${totalMarksIn} of ${totalMarksDue} student-subject marks`}
            />
          </div>
          <StatCard
            label="Subjects submitted"
            value={`${complete.length} / ${progressRows.length}`}
            detail="a section counts only when every student has a mark"
            tone={outstanding === 0 && progressRows.length > 0 ? "good" : "warn"}
          />
          <StatCard
            label="Subjects configured"
            value={subjectRows.length}
            detail={`across ${classCount} class${classCount === 1 ? "" : "es"}`}
            tone="neutral"
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="space-y-5 p-4"
            style={{
              borderRadius: "var(--radius-card)",
              background: "var(--surface-raised)",
              border: "1px solid var(--line-hairline)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <StatusControl examId={exam.id} current={status} />
            <hr style={{ borderColor: "var(--line-hairline)" }} />
            <RoutinePublisher
              examId={exam.id}
              publishedAt={exam.routine_published_at}
              subjectCount={subjectRows.length}
            />
          </section>

          <section
            className="p-4"
            style={{
              borderRadius: "var(--radius-card)",
              background: "var(--surface-raised)",
              border: "1px solid var(--line-hairline)",
              boxShadow: "var(--shadow-card)",
            }}
          >
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
          </section>
        </div>

        {/* Submission tracking: who has entered marks and who has not. */}
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
            <h2 className="text-sm font-semibold">
              Mark submission
              <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
                outstanding first
              </span>
            </h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              &quot;Not submitted&quot; means the teacher has not finished. It is
              not a claim about any student.
            </p>
          </header>

          {progressRows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No subjects are configured yet, so there is nothing to submit.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Mark entry progress by class, section and subject</caption>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">Class</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Subject</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Teacher</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Marks in</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">State</th>
                  </tr>
                </thead>
                <tbody>
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
                        <tr
                          key={`${r.exam_subject_id}-${r.section_id}`}
                          style={{ borderBottom: "1px solid var(--line-hairline)" }}
                        >
                          <td className="px-4 py-2">
                            {r.class_name}
                            {r.section_name && ` — ${r.section_name}`}
                          </td>
                          <td className="px-3 py-2">{r.subject_name}</td>
                          <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                            {r.teacher_name ?? (
                              <span style={{ color: "var(--state-bad)" }}>none assigned</span>
                            )}
                          </td>
                          <td className="numeric px-3 py-2 text-right">
                            {Number(r.marks_entered)} / {Number(r.roster)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {done ? (
                              <Pill tone="good">Submitted</Pill>
                            ) : r.submitted_at !== null ? (
                              <Pill tone="warn">Submitted, incomplete</Pill>
                            ) : Number(r.marks_entered) > 0 ? (
                              <Pill tone="warn">In progress</Pill>
                            ) : (
                              <Pill tone="bad">Not submitted</Pill>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <SubjectAdder
          examId={exam.id}
          classes={(classes.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
          subjectsByClass={subjectsByClass}
          locked={locked}
        />

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
            <h2 className="text-sm font-semibold">Subjects in this exam</h2>
          </header>

          {subjectRows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              None yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Configured exam subjects</caption>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">Class</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Subject</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Out of</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Pass mark</th>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {subjectRows.map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                      <td className="px-4 py-2">{s.className}</td>
                      <td className="px-3 py-2">{s.subjectName}</td>
                      <td className="numeric px-3 py-2 text-right">{Number(s.max_marks)}</td>
                      <td className="numeric px-3 py-2 text-right">
                        {s.pass_marks === null ? (
                          <span style={{ color: "var(--text-muted)" }}>
                            {scale.data ? `${Number(scale.data.subject_pass_pct)}% of max` : "scale"}
                          </span>
                        ) : (
                          Number(s.pass_marks)
                        )}
                      </td>
                      <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                        {s.exam_date ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PortalShell>
  );
}
