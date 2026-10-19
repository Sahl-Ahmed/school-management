import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { TEACHER_NAV } from "../nav";
import { Banner } from "@/components/form";
import { Pill } from "@/components/charts";
import { AttendanceRoster, type RosterStudent } from "./roster";
import { one } from "@/lib/supabase/relations";
import {
  schoolToday,
  longDate,
  addDays,
  weekdayOf,
} from "@/lib/school/calendar";
import { hhmm, WEEKDAY_NAMES } from "@/components/routine-grid";

export const metadata: Metadata = { title: "Attendance" };
export const dynamic = "force-dynamic";

export default async function TeacherAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; period?: string }>;
}) {
  const { date: dateParam, period: periodParam } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const today = schoolToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "") ? dateParam! : today;
  const weekday = weekdayOf(date);

  // The teacher's own periods for that weekday, still in effect on that date.
  // RLS already restricts routine_periods to this teacher, so no teacher_id
  // filter is needed and adding one would not change the result.
  const { data: periods } = await supabase
    .from("routine_periods")
    .select(`
      id, period_no, starts_at, ends_at, section_id, subject_id,
      classes(name), sections(name), subjects(name)
    `)
    .eq("weekday", weekday)
    .lte("effective_from", date)
    .or(`effective_to.is.null,effective_to.gte.${date}`)
    .order("starts_at");

  const lessons = (periods ?? []).map((p) => ({
    id: p.id,
    period_no: p.period_no,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    section_id: p.section_id,
    label: `${one<{ name: string }>(p.classes)?.name ?? "Class"}${
      one<{ name: string }>(p.sections)?.name ? ` — ${one<{ name: string }>(p.sections)!.name}` : ""
    }`,
    subject: one<{ name: string }>(p.subjects)?.name ?? "—",
  }));

  const selected = lessons.find((l) => l.id === periodParam) ?? lessons[0];

  // Which of these lessons already have submitted attendance, so the UI can
  // distinguish "done" from "still to do" rather than implying either.
  const { data: sessions } = await supabase
    .from("teaching_sessions")
    .select("routine_period_id, submitted_at, is_cancelled")
    .eq("session_date", date);

  const submittedBy = new Map(
    (sessions ?? []).map((s) => [s.routine_period_id, s]),
  );

  // Is the date itself a non-teaching day?
  const [{ data: weekends }, { data: holidays }] = await Promise.all([
    supabase.from("school_weekends").select("weekday"),
    supabase.from("school_holidays").select("name, class_id").eq("holiday_date", date),
  ]);

  const isWeekend = (weekends ?? []).some((w) => w.weekday === weekday);
  const holiday = (holidays ?? [])[0];

  // Roster and any existing marks for the selected lesson.
  let roster: RosterStudent[] = [];
  let existingSubmittedAt: string | null = null;

  if (selected) {
    const existing = submittedBy.get(selected.id);
    existingSubmittedAt = existing?.submitted_at ?? null;

    const { data: enrolled } = await supabase
      .from("student_enrollments")
      .select("roll_no, students(id, full_name, registration_no)")
      .eq("section_id", selected.section_id)
      .eq("status", "active")
      .order("roll_no");

    let marks = new Map<string, { status: string; remark: string | null }>();

    if (existing) {
      const { data: existingMarks } = await supabase
        .from("student_attendance")
        .select("student_id, status, remark, teaching_sessions!inner(routine_period_id, session_date)")
        .eq("teaching_sessions.routine_period_id", selected.id)
        .eq("teaching_sessions.session_date", date);

      marks = new Map(
        (existingMarks ?? []).map((m) => [m.student_id, { status: m.status, remark: m.remark }]),
      );
    }

    roster = (enrolled ?? []).flatMap((e) => {
      const st = one<{ id: string; full_name: string; registration_no: string }>(e.students);
      if (!st) return [];
      const mark = marks.get(st.id);
      return [{
        id: st.id,
        roll_no: e.roll_no,
        full_name: st.full_name,
        registration_no: st.registration_no,
        current_status: mark?.status ?? null,
        current_remark: mark?.remark ?? null,
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
          <h1 className="text-xl font-semibold tracking-tight">Attendance</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {longDate(date)}
          </p>
        </header>

        {/* Date stepper. Links rather than a picker so the choice is shareable
            and the page stays a server component. */}
        <nav aria-label="Change date" className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={{ pathname: "/teacher/attendance", query: { date: addDays(date, -1) } }}
            className="rounded-lg border px-3 py-1.5 font-medium"
            style={{ borderColor: "var(--line-hairline)" }}
          >
            ← Previous day
          </Link>
          {date !== today && (
            <Link
              href={{ pathname: "/teacher/attendance", query: { date: today } }}
              className="rounded-lg px-3 py-1.5 font-medium"
              style={{ background: "var(--accent-soft)", color: "var(--green-900, var(--text-primary))" }}
            >
              Today
            </Link>
          )}
          <Link
            href={{ pathname: "/teacher/attendance", query: { date: addDays(date, 1) } }}
            className="rounded-lg border px-3 py-1.5 font-medium"
            style={{ borderColor: "var(--line-hairline)" }}
          >
            Next day →
          </Link>
        </nav>

        {isWeekend && (
          <Banner tone="info">
            {WEEKDAY_NAMES[weekday]} is a non-teaching day, so no lessons are
            scheduled and no attendance is due.
          </Banner>
        )}

        {holiday && (
          <Banner tone="info">
            {date} is a school holiday ({holiday.name}). No attendance is due,
            and none can be recorded.
          </Banner>
        )}

        {!isWeekend && !holiday && lessons.length === 0 && (
          <Banner tone="info">
            You have no periods scheduled on {WEEKDAY_NAMES[weekday]}.
          </Banner>
        )}

        {lessons.length > 0 && (
          <>
            <nav aria-label="Choose a lesson" className="overflow-x-auto">
              <ul className="flex gap-1 pb-1">
                {lessons.map((l) => {
                  const active = l.id === selected?.id;
                  const session = submittedBy.get(l.id);
                  const done = Boolean(session?.submitted_at);

                  return (
                    <li key={l.id}>
                      <Link
                        href={{
                          pathname: "/teacher/attendance",
                          query: { date, period: l.id },
                        }}
                        aria-current={active ? "page" : undefined}
                        className="block whitespace-nowrap px-3 py-2 text-sm"
                        style={{
                          borderRadius: "var(--radius-control)",
                          background: active ? "var(--accent)" : "var(--surface-raised)",
                          color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
                          border: `1px solid ${active ? "var(--accent)" : "var(--line-hairline)"}`,
                        }}
                      >
                        <span className="block font-medium">{l.subject}</span>
                        <span className="numeric block text-xs opacity-80">
                          {l.label} · {hhmm(l.starts_at)}
                        </span>
                        <span className="mt-1 block">
                          {done ? (
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
              <AttendanceRoster
                routinePeriodId={selected.id}
                sessionDate={date}
                lessonLabel={`${selected.subject} · ${selected.label} · period ${selected.period_no}`}
                students={roster}
                alreadySubmittedAt={existingSubmittedAt}
                disabled={isWeekend || Boolean(holiday)}
              />
            )}
          </>
        )}
      </div>
    </PortalShell>
  );
}
