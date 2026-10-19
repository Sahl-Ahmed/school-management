import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell, type NavItem } from "@/components/portal-shell";

export const metadata: Metadata = { title: "Authority" };

/**
 * Per-user data behind a session; never prerendered and never cached, so one
 * user's dashboard can never be served to another.
 */
export const dynamic = "force-dynamic";


const NAV: NavItem[] = [
  { label: "Dashboard", href: "/authority" },
  { label: "Students", note: "phase 2" },
  { label: "Teachers", note: "phase 2" },
  { label: "Routine", note: "phase 3" },
  { label: "Fees", note: "phase 4" },
  { label: "Exams", note: "phase 5" },
  { label: "Documents", note: "phase 6" },
  { label: "Notifications", note: "phase 7" },
];

export default async function AuthorityDashboard() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  // Real counts, read under the caller's own permissions. Every figure below
  // comes from the database; none is placeholder data.
  const [students, teachers, year, unsubmitted, classes] = await Promise.all([
    supabase.from("students").select("gender", { count: "exact" }).eq("status", "active"),
    supabase.from("teachers").select("gender", { count: "exact" }).eq("is_active", true),
    supabase
      .from("academic_years")
      .select("name, starts_on, ends_on")
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("teaching_sessions")
      .select("id", { count: "exact", head: true })
      .is("submitted_at", null)
      .eq("is_cancelled", false),
    supabase
      .from("classes")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
  ]);

  const studentRows = students.data ?? [];
  const teacherRows = teachers.data ?? [];

  const tally = (rows: { gender: string }[], g: string) =>
    rows.filter((r) => r.gender === g).length;

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={NAV}
    >
      <div className="space-y-6">
        <section>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Academic year {year.data?.name ?? "not set"}
            {year.data && ` · ${year.data.starts_on} to ${year.data.ends_on}`}
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Active students"
            value={students.count ?? 0}
            detail={`${tally(studentRows, "male")} male · ${tally(studentRows, "female")} female`}
          />
          <Stat
            label="Active teachers"
            value={teachers.count ?? 0}
            detail={`${tally(teacherRows, "male")} male · ${tally(teacherRows, "female")} female`}
          />
          <Stat
            label="Lessons awaiting attendance"
            value={unsubmitted.count ?? 0}
            detail="Scheduled, not cancelled, not yet submitted"
          />
          <Stat
            label="Active classes"
            value={classes.count ?? 0}
            detail="Play, Nursery and numbered classes"
          />
        </section>

        {/*
          Honest status panel. The brief is explicit that a screen existing is
          not a feature being done, so the portal states plainly what is wired
          to real data and what is not yet built, rather than showing invented
          charts that imply working analytics.
        */}
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--border-subtle)", background: "var(--surface-raised)" }}
        >
          <h2 className="text-sm font-semibold">Build status</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Phase 1 delivered the data model, permissions and accounts. The
            counters above are live queries. The sections below are not built
            yet, and appear greyed out in the navigation above.
          </p>
          <ul className="mt-3 grid gap-1.5 text-sm" style={{ color: "var(--text-muted)" }}>
            <li>Phase 2 — student and teacher admission forms, account activation</li>
            <li>Phase 3 — routine builder, attendance submission, dashboard charts</li>
            <li>Phase 4 — fee posting and receipts</li>
            <li>Phase 5 — exams, marks, result publishing</li>
            <li>Phase 6 — feedback, admit cards, ID cards, printable PDFs</li>
            <li>Phase 7 — library and SMS delivery</li>
            <li>Phase 8 — K40 fingerprint bridge</li>
          </ul>
        </section>
      </div>
    </PortalShell>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border-subtle)", background: "var(--surface-raised)" }}
    >
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="numeric mt-1 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        {detail}
      </p>
    </div>
  );
}
