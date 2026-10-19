import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { RoutineGrid, type RoutineCell } from "@/components/routine-grid";
import { RoutineEditor, type PickerOption } from "./routine-editor";
import { Banner } from "@/components/form";
import { one } from "@/lib/supabase/relations";
import { schoolToday } from "@/lib/school/calendar";

export const metadata: Metadata = { title: "Class routine" };
export const dynamic = "force-dynamic";

export default async function RoutinePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section: sectionParam } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const [year, sections, subjects, teachers, weekends] = await Promise.all([
    supabase.from("academic_years").select("id, name").eq("is_current", true).maybeSingle(),
    supabase
      .from("sections")
      .select("id, name, class_id, classes(name, level_order)")
      .eq("is_active", true),
    supabase.from("subjects").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("teachers")
      .select("id, full_name, employee_code")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("school_weekends").select("weekday"),
  ]);

  const weekendDays = new Set((weekends.data ?? []).map((w) => w.weekday));
  // Only teaching days are rendered. In Bangladesh that is Sunday to Thursday,
  // so showing Friday and Saturday would waste a third of the grid.
  const teachingDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekendDays.has(d));

  const sectionOptions: PickerOption[] = (sections.data ?? [])
    .map((s) => {
      const cls = one<{ name: string; level_order: number }>(s.classes);
      return {
        id: s.id,
        label: `${cls?.name ?? "Class"}${s.name ? ` — Section ${s.name}` : ""}`,
        order: cls?.level_order ?? 0,
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ id, label }) => ({ id, label }));

  const selectedSection = sectionParam ?? sectionOptions[0]?.id;

  // Periods for the selected section. Closed periods are still shown, marked
  // with their end date, because the office needs to see what it closed.
  const { data: periods } = selectedSection
    ? await supabase
        .from("routine_periods")
        .select(
          `id, weekday, period_no, starts_at, ends_at, effective_from, effective_to,
           subjects(name), teachers(full_name)`,
        )
        .eq("section_id", selectedSection)
        .order("weekday")
        .order("starts_at")
    : { data: [] };

  const cells: RoutineCell[] = (periods ?? []).map((p) => ({
    id: p.id,
    weekday: p.weekday,
    period_no: p.period_no,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    subject_name: one<{ name: string }>(p.subjects)?.name ?? "—",
    teacher_name: one<{ full_name: string }>(p.teachers)?.full_name ?? "—",
    effective_to: p.effective_to,
  }));

  const currentLabel =
    sectionOptions.find((s) => s.id === selectedSection)?.label ?? "this section";

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Class routine</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              Academic year {year.data?.name ?? "not set"} · teaching days only
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* A route handler returning a PDF file, so a plain anchor and a
                download attribute — not a client-side navigation. */}
            <a
              href="/print/routine/school"
              download
              className="rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "var(--line-strong)" }}
            >
              School-wide A4 PDF
            </a>
            {selectedSection && (
              <a
                href={`/print/routine/section/${selectedSection}`}
                download
                className="rounded-lg px-3 py-2 text-sm font-medium"
                style={{ background: "var(--accent)", color: "var(--text-on-accent)" }}
              >
                This class A4 PDF
              </a>
            )}
          </div>
        </header>

        {!year.data ? (
          <Banner tone="error">
            No academic year is marked as current, so routine periods cannot be
            dated. Set the current year first.
          </Banner>
        ) : sectionOptions.length === 0 ? (
          <Banner tone="error">No active classes or sections exist yet.</Banner>
        ) : (
          <>
            {/* Section picker as links, so the choice is shareable and
                bookmarkable rather than trapped in component state. */}
            <nav aria-label="Choose a class" className="overflow-x-auto">
              <ul className="flex gap-1 pb-1">
                {sectionOptions.map((s) => {
                  const active = s.id === selectedSection;
                  return (
                    <li key={s.id}>
                      <Link
                        href={{ pathname: "/authority/routine", query: { section: s.id } }}
                        aria-current={active ? "page" : undefined}
                        className="block whitespace-nowrap px-3 py-1.5 text-sm font-medium"
                        style={{
                          borderRadius: "var(--radius-control)",
                          background: active ? "var(--accent)" : "var(--surface-raised)",
                          color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
                          border: `1px solid ${active ? "var(--accent)" : "var(--line-hairline)"}`,
                        }}
                      >
                        {s.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <section
              className="overflow-hidden"
              style={{
                borderRadius: "var(--radius-card)",
                background: "var(--surface-raised)",
                border: "1px solid var(--line-hairline)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <h2 className="px-4 py-3 text-sm font-semibold"
                  style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                {currentLabel}
              </h2>
              <RoutineGrid
                cells={cells}
                weekdays={teachingDays}
                emptyMessage={`No periods scheduled for ${currentLabel} yet. Add one below.`}
              />
            </section>

            <RoutineEditor
              academicYearId={year.data.id}
              sectionId={selectedSection!}
              sectionLabel={currentLabel}
              sections={sectionOptions}
              subjects={(subjects.data ?? []).map((s) => ({ id: s.id, label: s.name }))}
              teachers={(teachers.data ?? []).map((t) => ({
                id: t.id,
                label: `${t.full_name} (${t.employee_code})`,
              }))}
              teachingDays={teachingDays}
              defaultEffectiveFrom={year.data ? schoolToday() : ""}
              existing={cells.map((c) => ({
                id: c.id,
                weekday: c.weekday,
                period_no: c.period_no,
                starts_at: c.starts_at,
                ends_at: c.ends_at,
                subject_name: c.subject_name,
                teacher_name: c.teacher_name,
                effective_to: c.effective_to,
              }))}
            />
          </>
        )}
      </div>
    </PortalShell>
  );
}
