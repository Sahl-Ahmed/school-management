import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "./nav";
import { one } from "@/lib/supabase/relations";

export const metadata: Metadata = { title: "Student" };

/**
 * Per-user data behind a session; never prerendered and never cached, so one
 * user's dashboard can never be served to another.
 */
export const dynamic = "force-dynamic";


export default async function StudentHome() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  // RLS limits every one of these to this student's own rows. A filter by id
  // is unnecessary here, and its absence is the point: there is no id in the
  // URL that could be changed to reach someone else.
  const [student, enrollment, fees] = await Promise.all([
    supabase
      .from("students")
      .select("id, registration_no, full_name, gender, blood_group, date_of_birth, photo_path")
      .maybeSingle(),
    supabase
      .from("student_enrollments")
      .select("roll_no, classes(name), sections(name), academic_years(name)")
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("fee_charges")
      .select("amount, amount_paid, discount_amount, status"),
  ]);

  const charges = fees.data ?? [];
  const outstanding = charges
    .filter((c) => c.status === "pending" || c.status === "partial")
    .reduce(
      (sum, c) => sum + (Number(c.amount) - Number(c.amount_paid) - Number(c.discount_amount)),
      0,
    );

  const cls = one<{ name: string }>(enrollment.data?.classes);
  const sec = one<{ name: string }>(enrollment.data?.sections);
  const year = one<{ name: string }>(enrollment.data?.academic_years);

  return (
    <PortalShell
      portalName="Student portal"
      userName={profile?.full_name ?? "Student"}
      nav={STUDENT_NAV}
    >
      <div className="space-y-6">
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--line-hairline)", background: "var(--surface-raised)" }}
        >
          <h1 className="text-xl font-semibold tracking-tight">
            {student.data?.full_name ?? profile?.full_name}
          </h1>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <Detail label="Registration No" value={student.data?.registration_no} mono />
            <Detail label="Roll" value={enrollment.data?.roll_no} mono />
            <Detail label="Class" value={cls?.name} />
            <Detail label="Section" value={sec?.name} />
            <Detail label="Academic year" value={year?.name} />
            <Detail label="Blood group" value={student.data?.blood_group} />
          </dl>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: "var(--line-hairline)", background: "var(--surface-raised)" }}
          >
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Outstanding fees
            </p>
            <p className="numeric mt-1 text-2xl font-semibold">
              ৳{outstanding.toLocaleString("en-BD")}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Across {charges.filter((c) => c.status !== "paid").length} unpaid charges
            </p>
          </div>

          <div
            className="rounded-xl border p-4"
            style={{ borderColor: "var(--line-hairline)", background: "var(--surface-raised)" }}
          >
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Attendance
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              Your month-by-month figures are on the{" "}
              <Link href={"/student/attendance" as never} className="underline">
                attendance page
              </Link>
              . Lessons no teacher has submitted are excluded rather than
              counted as absences.
            </p>
          </div>
        </section>

        <section
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--line-hairline)", background: "var(--surface-raised)" }}
        >
          <h2 className="text-sm font-semibold">Not built yet</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Teacher feedback, the library, and your ID and admit cards arrive in
            later phases, and are greyed out in the navigation above. Attendance,
            fees and results are built and linked there now.
          </p>
        </section>
      </div>
    </PortalShell>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className={`font-medium ${mono ? "numeric" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}
