import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { Banner } from "@/components/form";
import { StudentForm, type SectionOption } from "./student-form";
import { AUTHORITY_NAV } from "../../nav";

export const metadata: Metadata = { title: "Admit a student" };
export const dynamic = "force-dynamic";

export default async function NewStudentPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();

  // Enrollment needs a current academic year; without one there is nothing to
  // enroll into, and silently defaulting would put the student in the wrong year.
  const { data: year } = await supabase
    .from("academic_years")
    .select("id, name")
    .eq("is_current", true)
    .maybeSingle();

  const { data: sections } = await supabase
    .from("sections")
    .select("id, name, classes(name, level_order)")
    .eq("is_active", true);

  const options: SectionOption[] = (sections ?? [])
    .map((s) => {
      const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
      return {
        id: s.id,
        label: `${cls?.name ?? "Class"}${s.name ? ` — Section ${s.name}` : ""}`,
        order: cls?.level_order ?? 0,
      };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ id, label }) => ({ id, label }));

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <div className="space-y-6">
        <header>
          <nav aria-label="Breadcrumb" className="mb-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <Link href="/authority/students" className="underline">Students</Link>
            <span aria-hidden="true"> / </span>
            <span>Admit</span>
          </nav>
          <h1 className="text-xl font-semibold tracking-tight">Admit a student</h1>
        </header>

        {!year ? (
          <Banner tone="error">
            No academic year is marked as current, so a student cannot be enrolled
            yet. Set the current year before admitting students.
          </Banner>
        ) : options.length === 0 ? (
          <Banner tone="error">
            No active classes or sections exist yet. Create a class before
            admitting students.
          </Banner>
        ) : (
          <StudentForm
            academicYearId={year.id}
            academicYearName={year.name}
            sections={options}
          />
        )}
      </div>
    </PortalShell>
  );
}
