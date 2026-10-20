import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "../nav";
import { RoutineGrid, type RoutineCell } from "@/components/routine-grid";
import {
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  PageSections,
} from "@/components/ui";
import { one } from "@/lib/supabase/relations";
import { schoolToday } from "@/lib/school/calendar";

export const metadata: Metadata = { title: "My routine" };
export const dynamic = "force-dynamic";

export default async function StudentRoutinePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const today = schoolToday();

  // RLS restricts routine_periods to the student's own section, so there is no
  // section id in the URL that could be changed to see another class.
  const [{ data: periods }, { data: weekends }, { data: enrollment }] = await Promise.all([
    supabase
      .from("routine_periods")
      .select(`
        id, weekday, period_no, starts_at, ends_at, effective_to,
        subjects(name), teachers(full_name)
      `)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order("weekday")
      .order("starts_at"),
    supabase.from("school_weekends").select("weekday"),
    supabase
      .from("student_enrollments")
      .select("section_id, classes(name), sections(name)")
      .eq("status", "active")
      .maybeSingle(),
  ]);

  const weekendDays = new Set((weekends ?? []).map((w) => w.weekday));
  const teachingDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekendDays.has(d));

  const cells: RoutineCell[] = (periods ?? []).map((p) => ({
    id: p.id,
    weekday: p.weekday,
    period_no: p.period_no,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    subject_name: one<{ name: string }>(p.subjects)?.name ?? "—",
    teacher_name: one<{ full_name: string }>(p.teachers)?.full_name ?? "—",
    effective_to: null,
  }));

  const cls = one<{ name: string }>(enrollment?.classes)?.name;
  const sec = one<{ name: string }>(enrollment?.sections)?.name;
  const label = cls ? `${cls}${sec ? ` — Section ${sec}` : ""}` : "your class";

  return (
    <PortalShell
      portalName="Student portal"
      userName={profile?.full_name ?? "Student"}
      nav={STUDENT_NAV}
    >
      <PageSections>
        <PageHeader
          title="My weekly routine"
          meta={`${label} · the periods in effect today`}
          actions={
            enrollment?.section_id ? (
              <ButtonLink
                href={`/print/routine/section/${enrollment.section_id}`}
                download
                icon="calendar"
              >
                Download A4 PDF
              </ButtonLink>
            ) : undefined
          }
        />

        <Card padded={false}>
          {cells.length === 0 ? (
            <EmptyState icon="calendar" title={`No routine for ${label} yet`}>
              The school office publishes the weekly timetable. Until it does,
              your lessons are not listed here — ask your class teacher what to
              expect.
            </EmptyState>
          ) : (
            <>
              <CardHeader
                title={label}
                hint="Non-teaching days are left out entirely, so every column on this grid is a day you attend."
              />
              <RoutineGrid cells={cells} weekdays={teachingDays} />
            </>
          )}
        </Card>
      </PageSections>
    </PortalShell>
  );
}
