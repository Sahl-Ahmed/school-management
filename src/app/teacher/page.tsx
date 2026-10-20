import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { TEACHER_NAV } from "./nav";
import { one } from "@/lib/supabase/relations";

export const metadata: Metadata = { title: "Teacher" };

/**
 * Per-user data behind a session; never prerendered and never cached, so one
 * user's dashboard can never be served to another.
 */
export const dynamic = "force-dynamic";


export default async function TeacherHome() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  // RLS restricts these to the caller's own record and assignments; no filter
  // on teacher_id is needed, and adding one would not change the result.
  const [teacher, assignments] = await Promise.all([
    supabase
      .from("teachers")
      .select("id, employee_code, full_name, designation")
      .maybeSingle(),
    supabase
      .from("teacher_assignments")
      .select("id, classes(name), sections(name), subjects(name), effective_from, effective_to"),
  ]);

  return (
    <PortalShell
      portalName="Teacher portal"
      userName={profile?.full_name ?? "Teacher"}
      nav={TEACHER_NAV}
    >
      <div className="space-y-6">
        <section>
          <h1 className="text-xl font-semibold tracking-tight">
            {teacher.data?.full_name ?? profile?.full_name}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {teacher.data?.designation ?? "Teacher"}
            {teacher.data?.employee_code && ` · ${teacher.data.employee_code}`}
          </p>
        </section>

        <section
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--line-hairline)", background: "var(--surface-raised)" }}
        >
          <h2 className="text-sm font-semibold">My assignments</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            These decide which classes, students and marks you can reach.
          </p>

          {(assignments.data?.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
              No assignments yet. The school office sets these through the class
              routine.
            </p>
          ) : (
            <ul className="mt-3 divide-y" style={{ borderColor: "var(--line-hairline)" }}>
              {assignments.data!.map((a) => {
                const cls = one<{ name: string }>(a.classes);
                const sec = one<{ name: string }>(a.sections);
                const sub = one<{ name: string }>(a.subjects);
                return (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 py-2 text-sm">
                    <span className="font-medium">{sub?.name}</span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {cls?.name}
                      {sec?.name && ` — Section ${sec.name}`}
                    </span>
                    <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                      from {a.effective_from}
                      {a.effective_to ? ` to ${a.effective_to}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--line-hairline)", background: "var(--surface-raised)" }}
        >
          <h2 className="text-sm font-semibold">Not built yet</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            The library, and your own attendance and leave, arrive in later
            phases and are greyed out in the navigation above. Attendance
            submission, mark entry and class tests are built and linked there
            now.
          </p>
        </section>
      </div>
    </PortalShell>
  );
}
