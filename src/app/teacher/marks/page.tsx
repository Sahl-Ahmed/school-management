import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { TEACHER_NAV } from "../nav";
import { Banner } from "@/components/form";
import { Pill } from "@/components/charts";
import { MarkSheet, type MarkRow } from "./mark-sheet";
import { one } from "@/lib/supabase/relations";

export const metadata: Metadata = { title: "Marks" };
export const dynamic = "force-dynamic";

/**
 * Teacher mark entry.
 *
 * What a teacher may enter is derived from teacher_assignments, never from the
 * URL: a task that is not in this list simply does not render, and the RPC
 * checks the same thing again on submission.
 */
export default async function TeacherMarksPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string }>;
}) {
  const { task: taskParam } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const { data: year } = await supabase
    .from("academic_years").select("id, name").eq("is_current", true).maybeSingle();

  // RLS restricts teacher_assignments to the caller, so no teacher_id filter is
  // needed and adding one would not change the result.
  const [assignments, teacher] = await Promise.all([
    year
      ? supabase
          .from("teacher_assignments")
          .select("class_id, section_id, subject_id, classes(name), sections(name), subjects(name)")
          .eq("academic_year_id", year.id)
      : Promise.resolve({ data: [] }),
    supabase.from("teachers").select("id").maybeSingle(),
  ]);

  // Exams whose marks are open. A teacher never sees a draft exam's sheet.
  const { data: openExams } = year
    ? await supabase
        .from("exams")
        .select("id, name, status, terms(name)")
        .eq("academic_year_id", year.id)
        .eq("status", "marks_open")
        .order("starts_on", { ascending: false, nullsFirst: false })
    : { data: [] };

  const examIds = (openExams ?? []).map((e) => e.id);

  const { data: examSubjects } = examIds.length
    ? await supabase
        .from("exam_subjects")
        .select("id, exam_id, class_id, subject_id, max_marks, pass_marks")
        .in("exam_id", examIds)
    : { data: [] };

  // The teacher's own submissions, so each sheet can say whether it is done.
  const { data: submissions } = await supabase
    .from("mark_submissions")
    .select("exam_subject_id, section_id, submitted_at");

  const submittedKey = new Set(
    (submissions ?? []).map((s) => `${s.exam_subject_id}:${s.section_id}`),
  );

  const examById = new Map((openExams ?? []).map((e) => [e.id, e]));

  /*
   * One task per (exam subject, section) the teacher is actually assigned to.
   * An exam subject covers a whole class; a teacher may teach only one of its
   * sections, so the pairing has to come from the assignment.
   */
  const tasks = (assignments.data ?? []).flatMap((a) =>
    (examSubjects ?? [])
      .filter((es) => es.class_id === a.class_id && es.subject_id === a.subject_id)
      .map((es) => {
        const exam = examById.get(es.exam_id);
        const key = `${es.id}:${a.section_id}`;
        return {
          key,
          examSubjectId: es.id,
          sectionId: a.section_id,
          examName: exam?.name ?? "Exam",
          termName: one<{ name: string }>(exam?.terms)?.name ?? "",
          className: one<{ name: string }>(a.classes)?.name ?? "Class",
          sectionName: one<{ name: string }>(a.sections)?.name ?? "",
          subjectName: one<{ name: string }>(a.subjects)?.name ?? "Subject",
          maxMarks: Number(es.max_marks),
          passMarks: es.pass_marks === null ? null : Number(es.pass_marks),
          submitted: submittedKey.has(key),
        };
      }),
  );

  tasks.sort(
    (a, b) =>
      Number(a.submitted) - Number(b.submitted) ||
      a.className.localeCompare(b.className) ||
      a.subjectName.localeCompare(b.subjectName),
  );

  const selected = tasks.find((t) => t.key === taskParam) ?? tasks[0];

  // Roster and any marks already entered for the selected sheet.
  let roster: MarkRow[] = [];

  if (selected) {
    const [{ data: enrolled }, { data: marks }] = await Promise.all([
      supabase
        .from("student_enrollments")
        .select("roll_no, students(id, full_name, registration_no)")
        .eq("section_id", selected.sectionId)
        .eq("status", "active")
        .order("roll_no"),
      supabase
        .from("marks")
        .select("student_id, marks_obtained, is_absent")
        .eq("exam_subject_id", selected.examSubjectId),
    ]);

    const byStudent = new Map(
      (marks ?? []).map((m) => [
        m.student_id,
        { marks: m.marks_obtained as string | null, absent: m.is_absent as boolean },
      ]),
    );

    roster = (enrolled ?? []).flatMap((e) => {
      const st = one<{ id: string; full_name: string; registration_no: string }>(e.students);
      if (!st) return [];
      const existing = byStudent.get(st.id);
      return [{
        student_id: st.id,
        roll_no: e.roll_no,
        full_name: st.full_name,
        registration_no: st.registration_no,
        // NULL here means "not entered", which is not a zero and not an
        // absence. The sheet renders it as an empty box.
        current_marks:
          existing && existing.marks !== null ? String(Number(existing.marks)) : null,
        current_absent: existing?.absent ?? false,
      }];
    });
  }

  return (
    <PortalShell
      portalName="Teacher portal"
      userName={profile?.full_name ?? "Teacher"}
      nav={TEACHER_NAV}
    >
      <div className="space-y-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Marks</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {year ? `Academic year ${year.name}` : "No academic year is set"}
            {" · only subjects you are assigned to teach"}
          </p>
        </header>

        {!teacher.data && (
          <Banner tone="error">
            Your account is not linked to a teacher record, so no mark sheet can
            be shown. The school office can fix this.
          </Banner>
        )}

        {(assignments.data ?? []).length === 0 && teacher.data && (
          <Banner tone="info">
            You have no subject assignments this year, so there is nothing to
            mark. The office sets these through the class routine.
          </Banner>
        )}

        {(openExams ?? []).length === 0 && (assignments.data ?? []).length > 0 && (
          <Banner tone="info">
            No exam is open for mark entry. The school office opens entry when it
            is time, and this page will then list your subjects.
          </Banner>
        )}

        {(openExams ?? []).length > 0 && tasks.length === 0 && (
          <Banner tone="info">
            An exam is open for marks, but none of its subjects match your
            assignments.
          </Banner>
        )}

        {tasks.length > 0 && (
          <>
            <nav aria-label="Choose a subject to mark" className="overflow-x-auto">
              <ul className="flex gap-1 pb-1">
                {tasks.map((t) => {
                  const active = t.key === selected?.key;
                  return (
                    <li key={t.key}>
                      <Link
                        href={{ pathname: "/teacher/marks", query: { task: t.key } }}
                        aria-current={active ? "page" : undefined}
                        className="block whitespace-nowrap px-3 py-2 text-sm"
                        style={{
                          borderRadius: "var(--radius-control)",
                          background: active ? "var(--accent)" : "var(--surface-raised)",
                          color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
                          border: `1px solid ${active ? "var(--accent)" : "var(--line-hairline)"}`,
                        }}
                      >
                        <span className="block font-medium">{t.subjectName}</span>
                        <span className="block text-xs opacity-80">
                          {t.className}
                          {t.sectionName && ` — ${t.sectionName}`} · {t.examName}
                        </span>
                        <span className="mt-1 block">
                          {t.submitted ? (
                            <Pill tone={active ? "neutral" : "good"}>Submitted</Pill>
                          ) : (
                            <Pill tone={active ? "neutral" : "warn"}>Not submitted</Pill>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {selected && (
              <MarkSheet
                examSubjectId={selected.examSubjectId}
                sectionId={selected.sectionId}
                label={`${selected.subjectName} · ${selected.className}${
                  selected.sectionName ? ` — ${selected.sectionName}` : ""
                } · ${selected.examName}`}
                maxMarks={selected.maxMarks}
                passMarks={selected.passMarks}
                students={roster}
                alreadySubmitted={selected.submitted}
                entryOpen
              />
            )}
          </>
        )}
      </div>
    </PortalShell>
  );
}
