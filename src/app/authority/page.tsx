import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "./nav";
import { Banner } from "@/components/form";
import {
  BarSeries,
  RingMeter,
  StatCard,
  percentageTone,
  type BarDatum,
} from "@/components/charts";
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
import { schoolToday, monthBounds, monthLabel, percentage, longDate } from "@/lib/school/calendar";

export const metadata: Metadata = { title: "Authority" };

/**
 * Per-user data behind a session; never prerendered and never cached, so one
 * user's dashboard can never be served to another.
 */
export const dynamic = "force-dynamic";

type SectionStat = {
  section_id: string;
  class_name: string;
  section_name: string;
  students: number;
  present_marks: number;
  submitted_marks: number;
  unsubmitted_sessions: number;
};

type PendingLesson = {
  routine_period_id: string;
  session_date: string;
  class_name: string;
  section_name: string;
  subject_name: string;
  teacher_name: string;
  starts_at: string;
};

export default async function AuthorityDashboard() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  const today = schoolToday();
  const { from, to } = monthBounds(today);

  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name, starts_on, ends_on")
    .eq("is_current", true)
    .maybeSingle();

  /*
   * Every figure below is a live query. Nothing on this page is a placeholder
   * or an illustrative number: the brief is explicit that invented statistics
   * must not be displayed, and a charting component here refuses to render a
   * percentage without its denominator.
   */
  const [students, teachers, sectionStats, pending, routinePeriods, feeRows, openWork] =
    await Promise.all([
      supabase.from("students").select("gender", { count: "exact" }).eq("status", "active"),
      supabase.from("teachers").select("gender", { count: "exact" }).eq("is_active", true),
      year
        ? supabase.rpc("section_attendance_stats", {
            p_academic_year_id: year.id,
            p_from: from,
            p_to: to,
          })
        : Promise.resolve({ data: [] as SectionStat[] }),
      supabase.rpc("pending_attendance", { p_from: from, p_to: today, p_teacher_id: null }),
      /*
       * Sections that actually have a routine.
       *
       * This replaces a figure labelled "Classes with a routine" that counted
       * sections with attendance activity this month — so it read 0 while
       * Class 3 plainly had a timetable. The label and the measure disagreed,
       * which is the kind of figure this project is not allowed to print.
       */
      supabase.from("routine_periods").select("section_id"),
      year
        ? supabase
            .from("fee_charges")
            .select("amount, amount_paid, discount_amount, status")
            .eq("academic_year_id", year.id)
        : Promise.resolve({ data: [] }),
      // Two counts the office acts on, rather than reads: exams awaiting marks
      // and students who have not finished the open feedback round.
      supabase
        .from("exams")
        .select("id, name, status", { count: "exact" })
        .eq("status", "marks_open"),
    ]);

  const studentRows = students.data ?? [];
  const teacherRows = teachers.data ?? [];
  const sections = (sectionStats.data ?? []) as SectionStat[];
  const pendingLessons = (pending.data ?? []) as PendingLesson[];

  const tally = (rows: { gender: string }[], g: string) =>
    rows.filter((r) => r.gender === g).length;

  const sectionsWithRoutine = new Set(
    (routinePeriods.data ?? []).map((p) => p.section_id as string),
  );

  // School-wide attendance for the month: summed marks, not an average of
  // averages, so a class of 40 is not weighted the same as a class of 4.
  const schoolPresent = sections.reduce((n, s) => n + Number(s.present_marks), 0);
  const schoolSubmitted = sections.reduce((n, s) => n + Number(s.submitted_marks), 0);

  // Money owed, for the year to date.
  const charges = feeRows.data ?? [];
  const outstanding = charges
    .filter((c) => c.status === "pending" || c.status === "partial")
    .reduce(
      (n, c) => n + (Number(c.amount) - Number(c.amount_paid) - Number(c.discount_amount)),
      0,
    );
  const studentsOwing = charges.filter(
    (c) => c.status === "pending" || c.status === "partial",
  ).length;

  const genderBars: BarDatum[] = (
    [
      { label: "Male", value: tally(studentRows, "male"), tone: "info" },
      { label: "Female", value: tally(studentRows, "female"), tone: "good" },
      { label: "Other", value: tally(studentRows, "other"), tone: "neutral" },
    ] satisfies BarDatum[]
  ).filter((d) => d.value > 0);

  // Classes with attendance submitted this month, worst first — the ones that
  // need attention are the point of the list.
  const attendanceBars: BarDatum[] = sections
    .filter((s) => Number(s.submitted_marks) > 0)
    .map((s) => {
      const pct = percentage(Number(s.present_marks), Number(s.submitted_marks))!;
      return {
        label: `${s.class_name}${s.section_name ? ` ${s.section_name}` : ""}`,
        value: Number(s.present_marks),
        display: `${pct}%`,
        tone: percentageTone(pct),
      };
    })
    .sort((a, b) => parseFloat(a.display!) - parseFloat(b.display!));

  const period = monthLabel(today);

  /*
   * Only the classes that have anyone in them.
   *
   * The table used to list all twelve, nine of which were empty rows of zeroes
   * and dashes — so the three classes that matter were buried in noise. The
   * count of empty ones is stated instead, which is the only thing a reader
   * needed from them.
   */
  const populated = sections.filter((s) => Number(s.students) > 0);
  const emptySections = sections.length - populated.length;

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          title={`Good day, ${profile?.full_name ?? "there"}`}
          meta={
            year
              ? `Academic year ${year.name} · ${longDate(today)}`
              : "No academic year is marked as current"
          }
          actions={
            <>
              <NavButton href="/authority/students/new" icon="students">
                Admit a student
              </NavButton>
              <NavButton href="/authority/fees" tone="primary" icon="money">
                Record a payment
              </NavButton>
            </>
          }
        />

        {!year && (
          <Banner tone="error">
            No academic year is marked as current, so enrollment and attendance
            cannot be reported. Set the current year first.
          </Banner>
        )}

        {/* ---- The four figures, each with its basis -------------------- */}
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            label="Active students"
            value={students.count ?? 0}
            detail={`${tally(studentRows, "male")} male · ${tally(studentRows, "female")} female`}
            tone="info"
            icon="students"
          />
          <StatCard
            label="Active teachers"
            value={teachers.count ?? 0}
            detail={`${tally(teacherRows, "male")} male · ${tally(teacherRows, "female")} female`}
            tone="accent"
            icon="teachers"
          />
          <StatCard
            label="Attendance not submitted"
            value={pendingLessons.length}
            detail={`lessons scheduled in ${period}, still awaited`}
            tone={pendingLessons.length > 0 ? "warn" : "good"}
            icon="check"
          />
          <StatCard
            label="Sections with a routine"
            value={sectionsWithRoutine.size}
            detail={`of ${sections.length} active sections`}
            tone={sectionsWithRoutine.size < sections.length ? "warn" : "good"}
            icon="calendar"
          />
        </section>

        {/* ---- What needs doing, before any analysis -------------------- */}
        {(pendingLessons.length > 0 || (openWork.count ?? 0) > 0 || outstanding > 0) && (
          <Card padded={false}>
            <CardHeader
              title="Needs your attention"
              hint="Drawn from live records, not a to-do list anyone typed."
            />
            <ul className="divide-y" style={{ borderColor: "var(--line-on-white)" }}>
              {pendingLessons.length > 0 && (
                <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <span className="min-w-0 text-sm">
                    <strong className="numeric">{pendingLessons.length}</strong> lesson
                    {pendingLessons.length === 1 ? "" : "s"} in {period} have no attendance
                    submitted
                    <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                      A lesson nobody submitted is not the same as an absence, and is
                      not counted against any student.
                    </span>
                  </span>
                  <Status tone="warn" dot>
                    awaiting teachers
                  </Status>
                </li>
              )}

              {(openWork.count ?? 0) > 0 && (
                <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <span className="min-w-0 text-sm">
                    <strong className="numeric">{openWork.count}</strong> exam
                    {openWork.count === 1 ? " is" : "s are"} open for mark entry
                    <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                      Results cannot be published until every mark is in.
                    </span>
                  </span>
                  <NavButton href="/authority/exams" icon="exam">
                    Open exams
                  </NavButton>
                </li>
              )}

              {outstanding > 0 && (
                <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <span className="min-w-0 text-sm">
                    <strong className="numeric">৳{outstanding.toLocaleString("en-US")}</strong>{" "}
                    outstanding across {studentsOwing} unpaid charge
                    {studentsOwing === 1 ? "" : "s"}
                    <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                      Academic year {year?.name} to date.
                    </span>
                  </span>
                  <NavButton href="/authority/fees" icon="money">
                    Fees
                  </NavButton>
                </li>
              )}
            </ul>
          </Card>
        )}

        {/* ---- Attendance ------------------------------------------------ */}
        <section className="grid gap-5 lg:grid-cols-3">
          <Card>
            <RingMeter
              value={schoolPresent}
              denominator={schoolSubmitted}
              label="School-wide attendance"
              period={period}
            />
            <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Counted from submitted lessons only. Summed across the school
              rather than averaged per class, so a class of forty is not weighted
              the same as a class of four.
            </p>
          </Card>

          <Card>
            <BarSeries
              data={genderBars}
              total={students.count ?? 0}
              caption="Students by gender"
              emptyMessage="No active students yet"
            />
          </Card>

          <Card>
            <BarSeries
              data={attendanceBars}
              total={schoolSubmitted}
              caption="Attendance by class"
              period={period}
              emptyMessage="No attendance submitted this month yet"
            />
            {attendanceBars.length > 0 && (
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Lowest first. The bar length is the number present; the figure is
                the percentage of submitted lessons.
              </p>
            )}
          </Card>
        </section>

        {/* ---- Classes ---------------------------------------------------- */}
        <Card padded={false}>
          <CardHeader
            title="Classes"
            hint={
              emptySections > 0
                ? `${period}. ${emptySections} section${emptySections === 1 ? " has" : "s have"} no students enrolled and ${emptySections === 1 ? "is" : "are"} not listed.`
                : period
            }
            actions={<NavButton href="/authority/routine" icon="calendar">Routine</NavButton>}
          />

          {populated.length === 0 ? (
            <EmptyState
              icon="students"
              title="No students are enrolled yet"
              action={<NavButton href="/authority/students/new" tone="primary" icon="students">Admit the first student</NavButton>}
            >
              Once students are admitted and placed in a class, their roster and
              attendance appear here.
            </EmptyState>
          ) : (
            <DataTable
              caption={`Per-class roster and attendance for ${period}`}
              head={
                <>
                  <Th>Class</Th>
                  <Th align="right">Students</Th>
                  <Th align="right">Attendance</Th>
                  <Th align="right">Submitted</Th>
                  <Th align="right">Awaiting</Th>
                  <Th align="right">Routine</Th>
                </>
              }
            >
              {populated.map((s) => {
                const pct = percentage(Number(s.present_marks), Number(s.submitted_marks));
                const hasRoutine = sectionsWithRoutine.has(s.section_id);

                return (
                  <Tr key={s.section_id}>
                    <Td>
                      <span className="font-medium">
                        {s.class_name}
                        {s.section_name && ` — ${s.section_name}`}
                      </span>
                    </Td>
                    <Td numeric>{Number(s.students)}</Td>
                    <Td align="right">
                      {pct === null ? (
                        <span style={{ color: "var(--text-muted)" }}>not submitted</span>
                      ) : (
                        <Status tone={percentageTone(pct)}>{pct}%</Status>
                      )}
                    </Td>
                    <Td numeric>{Number(s.submitted_marks)}</Td>
                    <Td numeric>
                      {Number(s.unsubmitted_sessions) > 0 ? (
                        <span style={{ color: "var(--state-warn)" }}>
                          {Number(s.unsubmitted_sessions)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </Td>
                    <Td align="right">
                      {hasRoutine ? (
                        <Status tone="good">set</Status>
                      ) : (
                        <Status tone="warn">none</Status>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </DataTable>
          )}
        </Card>

        {/* ---- Outstanding attendance ------------------------------------ */}
        {pendingLessons.length > 0 && (
          <Card padded={false}>
            <CardHeader
              title="Attendance not submitted"
              hint={`${pendingLessons.length} lesson${pendingLessons.length === 1 ? "" : "s"} in ${period}, oldest first. Derived from the routine, so a lesson that should have happened is listed even if no record was ever created for it.`}
            />
            <DataTable
              caption="Lessons with no attendance submitted"
              head={
                <>
                  <Th>Date</Th>
                  <Th>Subject</Th>
                  <Th>Class</Th>
                  <Th>Teacher</Th>
                </>
              }
            >
              {pendingLessons.slice(0, 15).map((p) => (
                <Tr key={`${p.routine_period_id}-${p.session_date}`}>
                  <Td numeric align="left">{p.session_date}</Td>
                  <Td>
                    <span className="font-medium">{p.subject_name}</span>
                  </Td>
                  <Td>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {p.class_name}
                      {p.section_name && ` — ${p.section_name}`}
                    </span>
                  </Td>
                  <Td>
                    <span style={{ color: "var(--text-secondary)" }}>{p.teacher_name}</span>
                  </Td>
                </Tr>
              ))}
            </DataTable>

            {pendingLessons.length > 15 && (
              <CardBody className="pt-0">
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  and {pendingLessons.length - 15} more.
                </p>
              </CardBody>
            )}
          </Card>
        )}

        {/* ---- What is still to come ------------------------------------- */}
        <Card>
          <h2 className="text-sm font-semibold">Not built yet</h2>
          <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Live SMS delivery and the K40 fingerprint terminal are pending: no
            provider account is connected and the device has not been bought.
            Messages are rendered, costed and recorded in simulation so the
            workflow can be checked, and nothing reaches a phone.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <NavButton href="/authority/notifications" icon="bell">
              See the message queue
            </NavButton>
          </p>
        </Card>
      </PageSections>
    </PortalShell>
  );
}
