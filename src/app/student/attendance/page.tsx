import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "../nav";
import { Banner } from "@/components/form";
import {
  RingMeter,
  BarSeries,
  StatCard,
  percentageTone,
  type BarDatum,
} from "@/components/charts";
import {
  Card,
  DataTable,
  FieldList,
  NavButton,
  PageHeader,
  PageSections,
  Status,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import {
  schoolToday,
  monthBounds,
  monthLabel,
  addMonths,
  percentage,
} from "@/lib/school/calendar";

export const metadata: Metadata = { title: "My attendance" };
export const dynamic = "force-dynamic";

type Stats = {
  present: number;
  late: number;
  absent: number;
  excused: number;
  submitted: number;
  unsubmitted_scheduled: number;
};

type BySubject = {
  subject_id: string;
  subject_name: string;
  present: number;
  absent: number;
  submitted: number;
};

export default async function StudentAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const today = schoolToday();
  // A month is identified by any date inside it; the first of the month keeps
  // the URL readable.
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(monthParam ?? "") ? monthParam! : today;
  const { from, to } = monthBounds(anchor);

  // RLS limits these to the caller's own record, and the functions also check
  // visibility themselves because they are SECURITY DEFINER. There is no
  // student id in the URL that could be changed to reach someone else.
  const { data: student } = await supabase
    .from("students")
    .select("id, full_name, registration_no")
    .maybeSingle();

  if (!student) {
    return (
      <PortalShell
        portalName="Student portal"
        userName={profile?.full_name ?? "Student"}
        nav={STUDENT_NAV}
      >
        <Banner tone="error">
          Your student record could not be loaded. Please contact the school office.
        </Banner>
      </PortalShell>
    );
  }

  const [statsResult, subjectResult, yearResult] = await Promise.all([
    supabase.rpc("student_attendance_stats", {
      p_student_id: student.id,
      p_from: from,
      p_to: to,
    }),
    supabase.rpc("student_attendance_by_subject", {
      p_student_id: student.id,
      p_from: from,
      p_to: to,
    }),
    supabase.from("academic_years").select("starts_on, ends_on, name").eq("is_current", true).maybeSingle(),
  ]);

  const stats = (statsResult.data ?? {
    present: 0, late: 0, absent: 0, excused: 0, submitted: 0, unsubmitted_scheduled: 0,
  }) as Stats;

  const bySubject = (subjectResult.data ?? []) as BySubject[];

  // Year-to-date, so a student sees both the month and the overall picture.
  const yearStats = yearResult.data
    ? ((await supabase.rpc("student_attendance_stats", {
        p_student_id: student.id,
        p_from: yearResult.data.starts_on,
        p_to: today,
      })).data as Stats | null)
    : null;

  const monthPct = percentage(stats.present, stats.submitted);

  const subjectBars: BarDatum[] = bySubject.map((s) => {
    const pct = percentage(s.present, s.submitted);
    return {
      label: s.subject_name,
      value: s.present,
      display: pct === null ? "no data" : `${pct}%`,
      tone: pct === null ? "neutral" : percentageTone(pct),
    };
  });

  const period = monthLabel(anchor);

  return (
    <PortalShell
      portalName="Student portal"
      userName={profile?.full_name ?? "Student"}
      nav={STUDENT_NAV}
    >
      <PageSections>
        <PageHeader
          title="My attendance"
          meta={
            <>
              {student.full_name} · {student.registration_no} · {period}
            </>
          }
          actions={
            /* The month stepper names the months either side rather than
               saying "previous" and "next", so a tap needs no counting. */
            <nav
              aria-label="Change month"
              className="inline-flex overflow-hidden"
              style={{
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--line-strong)",
                background: "var(--surface-raised)",
              }}
            >
              <Link
                href={{ pathname: "/student/attendance", query: { month: addMonths(anchor, -1) } }}
                className="px-3 py-2.5 text-sm font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                ← {monthLabel(addMonths(anchor, -1))}
              </Link>
              <Link
                href={{ pathname: "/student/attendance", query: { month: addMonths(anchor, 1) } }}
                className="px-3 py-2.5 text-sm font-medium"
                style={{
                  borderLeft: "1px solid var(--line-on-white)",
                  color: "var(--text-secondary)",
                }}
              >
                {monthLabel(addMonths(anchor, 1))} →
              </Link>
            </nav>
          }
        />

        {/* The honesty note that the whole attendance model turns on. Shown
            whenever any lesson is outstanding, because otherwise a low
            denominator looks like a mistake. */}
        {stats.unsubmitted_scheduled > 0 && (
          <Banner tone="info">
            {stats.unsubmitted_scheduled} scheduled{" "}
            {stats.unsubmitted_scheduled === 1 ? "lesson" : "lessons"} in {period}{" "}
            {stats.unsubmitted_scheduled === 1 ? "has" : "have"} no attendance
            submitted yet. Those are not counted as absences, and are excluded
            from the percentages below.
          </Banner>
        )}

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Card className="col-span-2">
            <RingMeter
              value={stats.present}
              denominator={stats.submitted}
              label={`Attendance in ${period}`}
              period={`${stats.submitted} submitted ${stats.submitted === 1 ? "lesson" : "lessons"}`}
            />
          </Card>

          <StatCard
            label="Absent"
            value={stats.absent}
            detail={`of ${stats.submitted} submitted lessons`}
            tone={stats.absent > 0 ? "bad" : "good"}
            icon="clipboard"
          />
          <StatCard
            label="Late"
            value={stats.late}
            detail="counted as present"
            tone={stats.late > 0 ? "warn" : "neutral"}
            icon="check"
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <Card>
            <BarSeries
              data={subjectBars}
              total={stats.submitted}
              caption={`By subject, ${period}`}
              emptyMessage="No attendance submitted for this month yet"
            />
            {bySubject.length > 0 && (
              <div className="mt-5">
                <DataTable
                  caption={`Attendance by subject in ${period}`}
                  head={
                    <>
                      <Th>Subject</Th>
                      <Th align="right">Present</Th>
                      <Th align="right">Absent</Th>
                      <Th align="right">Submitted</Th>
                    </>
                  }
                >
                  {bySubject.map((s) => (
                    <Tr key={s.subject_id}>
                      <Td>{s.subject_name}</Td>
                      <Td numeric>{s.present}</Td>
                      <Td numeric>{s.absent}</Td>
                      <Td numeric>{s.submitted}</Td>
                    </Tr>
                  ))}
                </DataTable>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold">
              Academic year {yearResult.data?.name ?? "—"} so far
            </h2>
            {yearStats ? (
              <>
                <RingMeter
                  value={yearStats.present}
                  denominator={yearStats.submitted}
                  label="Year to date"
                  period={`${yearResult.data?.starts_on} to ${today}`}
                />
                <div className="mt-5">
                  <FieldList
                    items={[
                      { label: "Present", value: yearStats.present, numeric: true },
                      { label: "Absent", value: yearStats.absent, numeric: true },
                      { label: "Excused", value: yearStats.excused, numeric: true },
                      {
                        label: "Awaiting submission",
                        value: (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="numeric">
                              {yearStats.unsubmitted_scheduled}
                            </span>
                            <Status tone="neutral">not absence</Status>
                          </span>
                        ),
                      },
                    ]}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No academic year is marked as current.
              </p>
            )}
          </Card>
        </section>

        {monthPct === null && (
          <Card>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              No attendance has been submitted for {period}, so no percentage can
              be shown. A percentage of zero would mean you were absent; an empty
              one means nothing has been recorded.
            </p>
            <p className="mt-4">
              <NavButton href="/student/routine" icon="calendar">
                My routine
              </NavButton>
            </p>
          </Card>
        )}
      </PageSections>
    </PortalShell>
  );
}
