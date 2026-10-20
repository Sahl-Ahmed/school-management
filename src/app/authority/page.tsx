import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "./nav";
import { Banner } from "@/components/form";
import {
  RingMeter,
  BarSeries,
  StatCard,
  Pill,
  percentageTone,
  type BarDatum,
} from "@/components/charts";
import {
  schoolToday,
  monthBounds,
  monthLabel,
  percentage,
} from "@/lib/school/calendar";

export const metadata: Metadata = { title: "Authority" };

/**
 * Per-user data behind a session; never prerendered and never cached, so one
 * user's dashboard can never be served to another.
 */
export const dynamic = "force-dynamic";

type SectionStat = {
  section_id: string;
  class_id: string;
  class_name: string;
  section_name: string;
  level_order: number;
  students: number;
  male: number;
  female: number;
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
  const [students, teachers, sectionStats, pending] = await Promise.all([
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
  ]);

  const studentRows = students.data ?? [];
  const teacherRows = teachers.data ?? [];
  const sections = (sectionStats.data ?? []) as SectionStat[];
  const pendingLessons = (pending.data ?? []) as PendingLesson[];

  const tally = (rows: { gender: string }[], g: string) =>
    rows.filter((r) => r.gender === g).length;

  // School-wide attendance for the month: summed marks, not an average of
  // averages, so a class of 40 is not weighted the same as a class of 4.
  const schoolPresent = sections.reduce((n, s) => n + Number(s.present_marks), 0);
  const schoolSubmitted = sections.reduce((n, s) => n + Number(s.submitted_marks), 0);

  const genderBars: BarDatum[] = (
    [
      { label: "Male", value: tally(studentRows, "male"), tone: "accent" },
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

  const totalUnsubmitted = sections.reduce(
    (n, s) => n + Number(s.unsubmitted_sessions),
    0,
  );

  const period = monthLabel(today);

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {year ? (
              <>
                Academic year {year.name} · attendance figures cover {period}
              </>
            ) : (
              "No academic year is marked as current"
            )}
          </p>
        </header>

        {!year && (
          <Banner tone="error">
            No academic year is marked as current, so enrollment and attendance
            cannot be reported. Set the current year first.
          </Banner>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active students"
            value={students.count ?? 0}
            detail={`${tally(studentRows, "male")} male · ${tally(studentRows, "female")} female`}
          />
          <StatCard
            label="Active teachers"
            value={teachers.count ?? 0}
            detail={`${tally(teacherRows, "male")} male · ${tally(teacherRows, "female")} female`}
            tone="good"
          />
          <StatCard
            label="Lessons awaiting attendance"
            value={pendingLessons.length}
            detail={`scheduled in ${period}, not yet submitted`}
            tone={pendingLessons.length > 0 ? "warn" : "good"}
          />
          <StatCard
            label="Classes with a routine"
            value={sections.filter((s) => Number(s.submitted_marks) > 0 || Number(s.unsubmitted_sessions) > 0).length}
            detail={`of ${sections.length} active sections`}
            tone="neutral"
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div
            className="p-4"
            style={{
              borderRadius: "var(--radius-card)",
              background: "var(--surface-raised)",
              border: "1px solid var(--line-hairline)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <RingMeter
              value={schoolPresent}
              denominator={schoolSubmitted}
              label="School-wide attendance"
              period={`${period} · ${schoolSubmitted} submitted marks`}
            />
            {totalUnsubmitted > 0 && (
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                {totalUnsubmitted} lesson{totalUnsubmitted === 1 ? "" : "s"} with
                no submission are excluded from this figure. They are not
                counted as absences.
              </p>
            )}
          </div>

          <div
            className="p-4"
            style={{
              borderRadius: "var(--radius-card)",
              background: "var(--surface-raised)",
              border: "1px solid var(--line-hairline)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <BarSeries
              data={genderBars}
              total={students.count ?? 0}
              caption="Students by gender"
              emptyMessage="No students admitted yet"
            />
          </div>

          <div
            className="p-4"
            style={{
              borderRadius: "var(--radius-card)",
              background: "var(--surface-raised)",
              border: "1px solid var(--line-hairline)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <BarSeries
              data={attendanceBars}
              total={schoolSubmitted}
              caption="Attendance by class, lowest first"
              period={period}
              emptyMessage="No attendance submitted this month yet"
            />
          </div>
        </section>

        {/* Per-class table. Classes with no submitted attendance show "no data"
            rather than 0%, because zero would read as a real measurement. */}
        <section
          className="overflow-hidden"
          style={{
            borderRadius: "var(--radius-card)",
            background: "var(--surface-raised)",
            border: "1px solid var(--line-hairline)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <h2
            className="px-4 py-3 text-sm font-semibold"
            style={{ borderBottom: "1px solid var(--line-hairline)" }}
          >
            Classes
            <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
              {period}
            </span>
          </h2>

          {sections.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No active sections yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Per-class roster and attendance for {period}
                </caption>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">Class</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Students</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Male</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Female</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Attendance</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Submitted</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Awaiting</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((s) => {
                    const pct = percentage(
                      Number(s.present_marks),
                      Number(s.submitted_marks),
                    );
                    return (
                      <tr
                        key={s.section_id}
                        style={{ borderBottom: "1px solid var(--line-hairline)" }}
                      >
                        <td className="px-4 py-2 font-medium">
                          {s.class_name}
                          {s.section_name && (
                            <span style={{ color: "var(--text-muted)" }}> — {s.section_name}</span>
                          )}
                        </td>
                        <td className="numeric px-3 py-2 text-right">{s.students}</td>
                        <td className="numeric px-3 py-2 text-right">{s.male}</td>
                        <td className="numeric px-3 py-2 text-right">{s.female}</td>
                        <td className="px-3 py-2 text-right">
                          {pct === null ? (
                            <span style={{ color: "var(--text-muted)" }}>no data</span>
                          ) : (
                            <Pill tone={percentageTone(pct)}>{pct}%</Pill>
                          )}
                        </td>
                        <td className="numeric px-3 py-2 text-right" style={{ color: "var(--text-muted)" }}>
                          {s.submitted_marks}
                        </td>
                        <td className="numeric px-4 py-2 text-right">
                          {Number(s.unsubmitted_sessions) > 0 ? (
                            <Pill tone="warn">{s.unsubmitted_sessions}</Pill>
                          ) : (
                            <span style={{ color: "var(--text-muted)" }}>—</span>
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

        {/* Overdue submissions, so the office can chase the specific teacher
            rather than seeing only a count. */}
        {pendingLessons.length > 0 && (
          <section
            className="overflow-hidden"
            style={{
              borderRadius: "var(--radius-card)",
              background: "var(--surface-raised)",
              border: "1px solid var(--line-hairline)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <h2
              className="px-4 py-3 text-sm font-semibold"
              style={{ borderBottom: "1px solid var(--line-hairline)" }}
            >
              Attendance not submitted
              <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
                {pendingLessons.length} lesson{pendingLessons.length === 1 ? "" : "s"} in {period}
              </span>
            </h2>
            <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
              {pendingLessons.slice(0, 15).map((p) => (
                <li
                  key={`${p.routine_period_id}-${p.session_date}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
                >
                  <span className="numeric" style={{ color: "var(--text-muted)" }}>
                    {p.session_date}
                  </span>
                  <span className="font-medium">{p.subject_name}</span>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {p.class_name}
                    {p.section_name && ` — ${p.section_name}`}
                  </span>
                  <span className="ml-auto" style={{ color: "var(--text-secondary)" }}>
                    {p.teacher_name}
                  </span>
                </li>
              ))}
            </ul>
            {pendingLessons.length > 15 && (
              <p className="px-4 py-2.5 text-xs" style={{ color: "var(--text-muted)" }}>
                and {pendingLessons.length - 15} more.
              </p>
            )}
          </section>
        )}

        <section
          className="p-5"
          style={{
            borderRadius: "var(--radius-card)",
            background: "var(--surface-accent)",
            border: "1px solid var(--line-hairline)",
          }}
        >
          <h2 className="text-sm font-semibold">Build status</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            Every figure above is a live query. What is left to build appears
            greyed out in the navigation.
          </p>
          <ul className="mt-3 grid gap-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            <li>Phase 7 — library, SMS delivery and result notifications</li>
            <li>Phase 8 — K40 fingerprint bridge</li>
            <li>Phase 9 — hardening and launch</li>
          </ul>
          <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            SMS is a development simulation until phase 7: nothing sent from
            this system reaches a phone yet.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href="/authority/routine" className="font-medium underline">
              Manage the class routine
            </Link>
            <Link href={"/authority/exams" as never} className="font-medium underline">
              Exams and results
            </Link>
            <Link href={"/authority/cards" as never} className="font-medium underline">
              Cards and printables
            </Link>
          </p>
        </section>
      </div>
    </PortalShell>
  );
}
