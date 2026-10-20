import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { Banner } from "@/components/form";
import { PageHeader, PageSections } from "@/components/ui";
import { TeacherForm, type Option } from "./teacher-form";
import { AUTHORITY_NAV } from "../../nav";
import { one } from "@/lib/supabase/relations";

export const metadata: Metadata = { title: "Add a teacher" };
export const dynamic = "force-dynamic";

export default async function NewTeacherPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const [year, sections, subjects, devices] = await Promise.all([
    supabase.from("academic_years").select("id, name").eq("is_current", true).maybeSingle(),
    supabase.from("sections").select("id, name, classes(name, level_order)").eq("is_active", true),
    supabase.from("subjects").select("id, name").eq("is_active", true).order("name"),
    supabase.from("devices").select("id, name, model").eq("is_active", true),
  ]);

  const sectionOptions: Option[] = (sections.data ?? [])
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

  const subjectOptions: Option[] = (subjects.data ?? []).map((s) => ({
    id: s.id,
    label: s.name,
  }));

  const deviceOptions: Option[] = (devices.data ?? []).map((d) => ({
    id: d.id,
    label: `${d.name} (${d.model})`,
  }));

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          breadcrumb={{ label: "Teachers", href: "/authority/teachers" }}
          title="Add a teacher"
          meta={year.data ? `Assignments for academic year ${year.data.name}` : undefined}
          description="This creates the teacher record and, optionally, their sign-in and their class assignments. Assignments decide what they can reach."
        />

        {!year.data ? (
          <Banner tone="error">
            No academic year is marked as current, so class assignments cannot be
            recorded. Set the current year first.
          </Banner>
        ) : (
          <TeacherForm
            academicYearId={year.data.id}
            sections={sectionOptions}
            subjects={subjectOptions}
            devices={deviceOptions}
          />
        )}
      </PageSections>
    </PortalShell>
  );
}
