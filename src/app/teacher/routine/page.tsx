import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { TEACHER_NAV } from "../nav";
import { RoutineGrid, type RoutineCell } from "@/components/routine-grid";
import { Banner } from "@/components/form";
import { one } from "@/lib/supabase/relations";
import { schoolToday } from "@/lib/school/calendar";

export const metadata: Metadata = { title: "My timetable" };
export const dynamic = "force-dynamic";

export default async function TeacherRoutinePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const today = schoolToday();

  // RLS restricts routine_periods to this teacher's own periods.
  const [{ data: periods }, { data: weekends }] = await Promise.all([
    supabase
      .from("routine_periods")
      .select(`
        id, weekday, period_no, starts_at, ends_at, effective_to,
        classes(name), sections(name), subjects(name), teachers(full_name)
      `)
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order("weekday")
      .order("starts_at"),
    supabase.from("school_weekends").select("weekday"),
  ]);

  const weekendDays = new Set((weekends ?? []).map((w) => w.weekday));
  const teachingDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekendDays.has(d));

  const cells: RoutineCell[] = (periods ?? []).map((p) => {
    const cls = one<{ name: string }>(p.classes)?.name ?? "Class";
    const sec = one<{ name: string }>(p.sections)?.name;
    return {
      id: p.id,
      weekday: p.weekday,
      period_no: p.period_no,
      starts_at: p.starts_at,
      ends_at: p.ends_at,
      subject_name: one<{ name: string }>(p.subjects)?.name ?? "—",
      // On a teacher's own timetable the useful second line is WHICH class,
      // not their own name.
      teacher_name: `${cls}${sec ? ` — ${sec}` : ""}`,
      effective_to: p.effective_to,
    };
  });

  return (
    <PortalShell
      portalName="Teacher portal"
      userName={profile?.full_name ?? "Teacher"}
      nav={TEACHER_NAV}
    >
      <div className="space-y-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">My timetable</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Periods in effect today. Each cell shows the subject and the class.
          </p>
        </header>

        {cells.length === 0 ? (
          <Banner tone="info">
            You have no periods scheduled. The school office sets these through
            the class routine.
          </Banner>
        ) : (
          <section
            className="overflow-hidden"
            style={{
              borderRadius: "var(--radius-card)",
              background: "var(--surface-raised)",
              border: "1px solid var(--line-hairline)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <RoutineGrid cells={cells} weekdays={teachingDays} />
          </section>
        )}
      </div>
    </PortalShell>
  );
}
