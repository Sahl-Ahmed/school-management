import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { fingerEnrollmentWarning } from "@/lib/validation/teacher";

export const metadata: Metadata = { title: "Teachers" };
export const dynamic = "force-dynamic";

export default async function TeachersPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const { data: teachers, error } = await supabase
    .from("teachers")
    .select(`
      id, employee_code, full_name, designation, is_active, auth_user_id,
      device_users(device_user_id, enrolled_fingers, is_active),
      teacher_assignments(id)
    `)
    .eq("is_active", true)
    .order("full_name");

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Teachers</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {teachers?.length ?? 0} active
            </p>
          </div>
          <Link
            href="/authority/teachers/new"
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            Add a teacher
          </Link>
        </header>

        {error ? (
          <p role="alert" className="rounded-lg px-3 py-2 text-sm"
             style={{ background: "var(--state-bad-soft)", color: "var(--state-bad)" }}>
            Could not load teachers: {error.message}
          </p>
        ) : (teachers?.length ?? 0) === 0 ? (
          <div className="rounded-xl border p-8 text-center"
               style={{ borderColor: "var(--line-hairline)", background: "var(--surface-raised)" }}>
            <p className="text-sm font-medium">No teachers yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {teachers!.map((t) => {
              const mapping = (t.device_users ?? []).find((d) => d.is_active);
              const warning = mapping
                ? fingerEnrollmentWarning(mapping.enrolled_fingers)
                : null;
              const assignmentCount = (t.teacher_assignments ?? []).length;

              return (
                <li key={t.id} className="rounded-xl border p-4"
                    style={{ borderColor: "var(--line-hairline)", background: "var(--surface-raised)" }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-medium">{t.full_name}</p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {t.employee_code}
                        {t.designation && ` · ${t.designation}`}
                        {` · ${assignmentCount} assignment${assignmentCount === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {t.auth_user_id ? "Account created" : "No account"}
                    </span>
                  </div>

                  <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {mapping
                      ? `Terminal ID ${mapping.device_user_id} · ${mapping.enrolled_fingers} finger${mapping.enrolled_fingers === 1 ? "" : "s"} enrolled`
                      : "No fingerprint terminal mapping"}
                  </p>

                  {warning && (
                    <p className="mt-2 rounded-lg px-2.5 py-1.5 text-xs"
                       style={{ background: "var(--state-warn-soft)", color: "var(--state-warn)" }}>
                      {warning}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PortalShell>
  );
}
