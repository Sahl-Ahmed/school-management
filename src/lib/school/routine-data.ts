import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { RoutineSection, SchoolBranding } from "@/lib/pdf/routine";

/**
 * Loads routine data for the PDF routes, under the CALLER's permissions.
 *
 * Deliberately uses the request-scoped client, not the service role: a PDF
 * route is just another read, and RLS decides what the signed-in user may see.
 * A teacher downloading the school-wide routine therefore gets only the periods
 * their policies allow, rather than the whole school's.
 */

export type RoutineLoad = {
  school: SchoolBranding;
  academicYear: string;
  teachingDays: number[];
  sections: RoutineSection[];
};

/** Periods still in effect on `onDate`. Closed periods are excluded from print. */
function isCurrent(p: { effective_from: string; effective_to: string | null }, onDate: string) {
  return p.effective_from <= onDate && (p.effective_to === null || p.effective_to >= onDate);
}

export async function loadRoutine(
  onDate: string,
  sectionId?: string,
): Promise<RoutineLoad | null> {
  const supabase = await createClient();

  const [settings, year, weekends] = await Promise.all([
    supabase
      .from("school_settings")
      .select("name, address, office_phone, email")
      .maybeSingle(),
    supabase.from("academic_years").select("id, name").eq("is_current", true).maybeSingle(),
    supabase.from("school_weekends").select("weekday"),
  ]);

  if (!year.data) return null;

  const weekendDays = new Set((weekends.data ?? []).map((w) => w.weekday));
  const teachingDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !weekendDays.has(d));

  let query = supabase
    .from("routine_periods")
    .select(`
      weekday, period_no, starts_at, ends_at, effective_from, effective_to,
      section_id,
      classes(name, level_order),
      sections(name),
      subjects(name),
      teachers(full_name)
    `)
    .eq("academic_year_id", year.data.id);

  if (sectionId) query = query.eq("section_id", sectionId);

  const { data: rows } = await query;

  const grouped = new Map<string, RoutineSection>();

  for (const row of rows ?? []) {
    if (!isCurrent(row, onDate)) continue;

    const cls = Array.isArray(row.classes) ? row.classes[0] : row.classes;
    const sec = Array.isArray(row.sections) ? row.sections[0] : row.sections;
    const subj = Array.isArray(row.subjects) ? row.subjects[0] : row.subjects;
    const teacher = Array.isArray(row.teachers) ? row.teachers[0] : row.teachers;

    const key = row.section_id;
    if (!grouped.has(key)) {
      grouped.set(key, {
        class_name: cls?.name ?? "Class",
        section_name: sec?.name ?? "",
        level_order: cls?.level_order ?? 0,
        periods: [],
      });
    }

    grouped.get(key)!.periods.push({
      weekday: row.weekday,
      period_no: row.period_no,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      subject_name: subj?.name ?? "—",
      teacher_name: teacher?.full_name ?? "—",
    });
  }

  const sections = [...grouped.values()].sort(
    (a, b) => a.level_order - b.level_order || a.section_name.localeCompare(b.section_name),
  );

  return {
    school: {
      name: settings.data?.name ?? "School",
      address: settings.data?.address ?? null,
      office_phone: settings.data?.office_phone ?? null,
      email: settings.data?.email ?? null,
    },
    academicYear: year.data.name,
    teachingDays,
    sections,
  };
}
