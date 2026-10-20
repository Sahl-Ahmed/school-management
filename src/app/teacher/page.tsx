import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { TEACHER_NAV } from "./nav";
import { one } from "@/lib/supabase/relations";
import { StatCard } from "@/components/charts";
import {
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  NavButton,
  PageHeader,
  PageSections,
  Status,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { hhmm, WEEKDAY_NAMES } from "@/components/routine-grid";
import {
  schoolToday,
  longDate,
  monthBounds,
  monthLabel,
  weekdayOf,
} from "@/lib/school/calendar";

export const metadata: Metadata = { title: "Teacher" };

/**
 * Per-user data behind a session; never prerendered and never cached, so one
 * user's dashboard can never be served to another.
 */
export const dynamic = "force-dynamic";

type PendingLesson = {
  routine_period_id: string;
  session_date: string;
  class_name: string;
  section_name: string;
  subject_name: string;
  starts_at: string;
};

/**
 * The teacher's day.
 *
 * This page used to be a profile card and a list of assignments — true, but
 * nothing a teacher needs at 8am. A teacher opens this product to do two
 * things: take attendance for the lesson they are walking into, and enter
 * marks before a deadline. So those two are the page, in that order, with
 * today's timetable first and each row saying plainly whether it is done.
 */
export default async function TeacherHome() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const today = schoolToday();
  const weekday = weekdayOf(today);
  const { from } = monthBounds(today);

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  /*
   * RLS restricts every one of these to the caller's own record, assignments
   * and periods, so no teacher_id filter is needed and adding one would not
   * change the result.
   */
  const [teacher, assignments, periods, sessions, pending, weekends, holidays] =
    await Promise.all([
      supabase
        .from("teachers")
        .select("id, employee_code, full_name, designation")
        .maybeSingle(),
      supabase
        .from("teacher_assignments")
        .select(
          "id, classes(name), sections(name), subjects(name), effective_from, effective_to",
        ),
      supabase
        .from("routine_periods")
        .select(
          "id, period_no, starts_at, ends_at, classes(name), sections(name), subjects(name)",
        )
        .eq("weekday", weekday)
        .lte("effective_from", today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order("starts_at"),
      supabase
        .from("teaching_sessions")
        .select("routine_period_id, submitted_at, is_cancelled")
        .eq("session_date", today),
      supabase.rpc("pending_attendance", {
        p_from: from,
        p_to: today,
        p_teacher_id: null,
      }),
      supabase.from("school_weekends").select("weekday"),
      supabase.from("school_holidays").select("name").eq("holiday_date", today),
    ]);

  const sessionByPeriod = new Map(
    (sessions.data ?? []).map((s) => [s.routine_period_id, s]),
  );

  const lessons = (periods.data ?? []).map((p) => {
    const session = sessionByPeriod.get(p.id);
    const sectionName = one<{ name: string }>(p.sections)?.name;
    return {
      id: p.id,
      period_no: p.period_no,
      starts_at: p.starts_at as string,
      ends_at: p.ends_at as string,
      subject: one<{ name: string }>(p.subjects)?.name ?? "—",
      className: `${one<{ name: string }>(p.classes)?.name ?? "Class"}${
        sectionName ? ` — ${sectionName}` : ""
      }`,
      submitted: Boolean(session?.submitted_at),
      cancelled: Boolean(session?.is_cancelled),
    };
  });

  const isWeekend = (weekends.data ?? []).some((w) => w.weekday === weekday);
  const holiday = (holidays.data ?? [])[0];
  const submittedToday = lessons.filter((l) => l.submitted).length;
  const dueToday = lessons.filter((l) => !l.submitted && !l.cancelled).length;

  // Lessons from earlier in the month that were never submitted. Today's are
  // listed above with their own status, so they are not repeated here.
  const pendingLessons = ((pending.data ?? []) as PendingLesson[])
    .filter((p) => p.session_date !== today)
    .sort((a, b) => a.session_date.localeCompare(b.session_date));

  /* ---- Mark sheets this teacher still owes ---------------------------- */

  const openExams = year
    ? await supabase
        .from("exams")
        .select("id, name")
        .eq("academic_year_id", year.id)
        .eq("status", "marks_open")
        .order("starts_on", { ascending: false, nullsFirst: false })
    : { data: [] as { id: string; name: string }[] };

  const examIds = (openExams.data ?? []).map((e) => e.id);

  const [examSubjects, submissions, assignmentRows] = await Promise.all([
    examIds.length
      ? supabase
          .from("exam_subjects")
          .select("id, exam_id, class_id, subject_id")
          .in("exam_id", examIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            exam_id: string;
            class_id: string;
            subject_id: string;
          }[],
        }),
    supabase.from("mark_submissions").select("exam_subject_id, section_id"),
    year
      ? supabase
          .from("teacher_assignments")
          .select("class_id, section_id, subject_id")
          .eq("academic_year_id", year.id)
      : Promise.resolve({
          data: [] as {
            class_id: string;
            section_id: string;
            subject_id: string;
          }[],
        }),
  ]);

  const submittedSheets = new Set(
    (submissions.data ?? []).map((s) => `${s.exam_subject_id}:${s.section_id}`),
  );

  /*
   * A sheet this teacher owes is the intersection of an open exam's subjects
   * with their own assignments — the same derivation the mark-entry page uses,
   * so this count can never promise a sheet that page would refuse to show.
   */
  const owedSheets = (examSubjects.data ?? []).flatMap((es) =>
    (assignmentRows.data ?? [])
      .filter((a) => a.class_id === es.class_id && a.subject_id === es.subject_id)
      .filter((a) => !submittedSheets.has(`${es.id}:${a.section_id}`))
      .map((a) => `${es.id}:${a.section_id}`),
  );

  const period = monthLabel(today);
  // The whole name, not a first name: splitting on a space greets a
  // "School Principal" as "School", and a mononym as nothing at all.
  const greetName = teacher.data?.full_name ?? profile?.full_name ?? "there";

  return (
    <PortalShell
      portalName="Teacher portal"
      userName={profile?.full_name ?? "Teacher"}
      nav={TEACHER_NAV}
    >
      <PageSections>
        <PageHeader
          title={`Good day, ${greetName}`}
          meta={
            <>
              {longDate(today)}
              {teacher.data?.designation && ` · ${teacher.data.designation}`}
              {teacher.data?.employee_code && ` · ${teacher.data.employee_code}`}
            </>
          }
          actions={
            <>
              <NavButton href="/teacher/routine" icon="calendar">
                My routine
              </NavButton>
              <NavButton href="/teacher/attendance" tone="primary" icon="check">
                Take attendance
              </NavButton>
            </>
          }
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            label="Lessons today"
            value={lessons.length}
            detail={
              isWeekend
                ? "today is a weekend"
                : holiday
                  ? `today is ${holiday.name}`
                  : `${WEEKDAY_NAMES[weekday]} in your routine`
            }
            tone="info"
            icon="calendar"
          />
          <StatCard
            label="Attendance due today"
            value={dueToday}
            detail={
              dueToday === 0 && lessons.length > 0
                ? "all of today's lessons are submitted"
                : `${submittedToday} of ${lessons.length} submitted so far`
            }
            tone={dueToday > 0 ? "warn" : "good"}
            icon="check"
          />
          <StatCard
            label="Earlier lessons awaited"
            value={pendingLessons.length}
            detail={`before today, in ${period}`}
            tone={pendingLessons.length > 0 ? "bad" : "good"}
            icon="clipboard"
          />
          <StatCard
            label="Mark sheets to submit"
            value={owedSheets.length}
            detail={
              examIds.length === 0
                ? "no exam is open for mark entry"
                : `across ${examIds.length} open exam${examIds.length === 1 ? "" : "s"}`
            }
            tone={owedSheets.length > 0 ? "warn" : "good"}
            icon="exam"
          />
        </section>

        {/* ---- Today's timetable ----------------------------------------- */}
        <Card padded={false}>
          <CardHeader
            title="Today's lessons"
            hint={`${longDate(today)}. Taken from the routine the office set, so a lesson appears here whether or not anyone has opened it yet.`}
            actions={
              lessons.length > 0 ? (
                <NavButton href="/teacher/attendance" icon="check">
                  Open attendance
                </NavButton>
              ) : undefined
            }
          />

          {lessons.length === 0 ? (
            <EmptyState
              icon="calendar"
              title={
                holiday
                  ? `Today is ${holiday.name}`
                  : isWeekend
                    ? "Today is a weekend"
                    : "No lessons on your routine today"
              }
              action={
                <NavButton href="/teacher/routine" icon="calendar">
                  See my whole week
                </NavButton>
              }
            >
              {holiday || isWeekend
                ? "Nothing is expected of you today. Your next teaching day is on your routine."
                : "You have no periods scheduled for this weekday. If that looks wrong, the school office maintains the routine."}
            </EmptyState>
          ) : (
            <DataTable
              caption={`Your lessons on ${longDate(today)}`}
              head={
                <>
                  {/* The period number goes on a phone: the time says the same
                      thing, and five columns at 375px wrap every cell. */}
                  <Th align="right" className="hidden sm:table-cell">
                    Period
                  </Th>
                  <Th>Time</Th>
                  <Th>Subject</Th>
                  <Th>Class</Th>
                  <Th align="right">Attendance</Th>
                </>
              }
            >
              {lessons.map((l) => (
                <Tr key={l.id}>
                  <Td numeric className="hidden sm:table-cell">
                    {l.period_no}
                  </Td>
                  <Td numeric align="left" className="whitespace-nowrap">
                    {hhmm(l.starts_at)}–{hhmm(l.ends_at)}
                  </Td>
                  <Td>
                    <span className="font-medium">{l.subject}</span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <span style={{ color: "var(--text-secondary)" }}>{l.className}</span>
                  </Td>
                  <Td align="right">
                    {l.cancelled ? (
                      <Status tone="neutral">cancelled</Status>
                    ) : l.submitted ? (
                      <Status tone="good">submitted</Status>
                    ) : (
                      <Status tone="warn" dot>
                        to do
                      </Status>
                    )}
                  </Td>
                </Tr>
              ))}
            </DataTable>
          )}
        </Card>

        {/* ---- Lessons still owed from earlier in the month --------------- */}
        {pendingLessons.length > 0 && (
          <Card padded={false}>
            <CardHeader
              title="Attendance you still owe"
              hint={`${pendingLessons.length} lesson${pendingLessons.length === 1 ? "" : "s"} earlier in ${period}, oldest first. A lesson nobody submitted is not recorded as absence for anyone.`}
              actions={
                <NavButton href="/teacher/attendance" tone="primary" icon="check">
                  Submit now
                </NavButton>
              }
            />
            <DataTable
              caption="Your lessons with no attendance submitted"
              head={
                <>
                  <Th>Date</Th>
                  <Th>Subject</Th>
                  <Th>Class</Th>
                </>
              }
            >
              {pendingLessons.slice(0, 12).map((p) => (
                <Tr key={`${p.routine_period_id}-${p.session_date}`}>
                  <Td numeric align="left">
                    {p.session_date}
                  </Td>
                  <Td>
                    <span className="font-medium">{p.subject_name}</span>
                  </Td>
                  <Td>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {p.class_name}
                      {p.section_name && ` — ${p.section_name}`}
                    </span>
                  </Td>
                </Tr>
              ))}
            </DataTable>
            {pendingLessons.length > 12 && (
              <CardBody className="pt-0">
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  and {pendingLessons.length - 12} more.
                </p>
              </CardBody>
            )}
          </Card>
        )}

        {/* ---- Marks ------------------------------------------------------ */}
        {owedSheets.length > 0 && (
          <Card>
            <h2 className="text-sm font-semibold">Mark sheets waiting on you</h2>
            <p
              className="mt-1.5 text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {owedSheets.length} sheet{owedSheets.length === 1 ? "" : "s"} across{" "}
              {examIds.length} open exam{examIds.length === 1 ? "" : "s"} have no
              marks submitted. Results cannot be published until every sheet is
              in, and a submitted sheet can still be corrected until the office
              closes mark entry.
            </p>
            <p className="mt-4">
              <NavButton href="/teacher/marks" tone="primary" icon="exam">
                Enter marks
              </NavButton>
            </p>
          </Card>
        )}

        {/* ---- Assignments ------------------------------------------------ */}
        <Card padded={false}>
          <CardHeader
            title="What I teach"
            hint={
              year
                ? `Academic year ${year.name}. These decide which classes, students and marks you can reach.`
                : "These decide which classes, students and marks you can reach."
            }
          />

          {(assignments.data?.length ?? 0) === 0 ? (
            <EmptyState icon="teachers" title="You have no assignments yet">
              The school office assigns a teacher to a class and subject through
              the routine. Until then, attendance and mark entry have nothing to
              show you.
            </EmptyState>
          ) : (
            <DataTable
              caption="My class and subject assignments"
              head={
                <>
                  <Th>Subject</Th>
                  <Th>Class</Th>
                  <Th align="right">In effect</Th>
                </>
              }
            >
              {assignments.data!.map((a) => {
                const cls = one<{ name: string }>(a.classes);
                const sec = one<{ name: string }>(a.sections);
                const sub = one<{ name: string }>(a.subjects);
                return (
                  <Tr key={a.id}>
                    <Td>
                      <span className="font-medium">{sub?.name}</span>
                    </Td>
                    <Td>
                      <span style={{ color: "var(--text-secondary)" }}>
                        {cls?.name}
                        {sec?.name && ` — Section ${sec.name}`}
                      </span>
                    </Td>
                    <Td numeric align="right">
                      {a.effective_from}
                      {a.effective_to ? ` → ${a.effective_to}` : ""}
                    </Td>
                  </Tr>
                );
              })}
            </DataTable>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold">Not built yet</h2>
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            Your own attendance and leave are not built, and are shown greyed out
            in the navigation. SMS to guardians is a simulation: a class-test
            result you send is rendered, costed and recorded, but no message
            reaches a phone until a provider is connected.
          </p>
        </Card>
      </PageSections>
    </PortalShell>
  );
}
