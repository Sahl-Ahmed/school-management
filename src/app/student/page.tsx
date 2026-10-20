import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "./nav";
import { one } from "@/lib/supabase/relations";
import { RingMeter, StatCard } from "@/components/charts";
import {
  Card,
  CardHeader,
  EmptyState,
  FieldList,
  NavButton,
  PageHeader,
  PageSections,
  Status,
} from "@/components/ui";
import { schoolToday, monthBounds, monthLabel, longDate } from "@/lib/school/calendar";

export const metadata: Metadata = { title: "Student" };

/**
 * Per-user data behind a session; never prerendered and never cached, so one
 * user's dashboard can never be served to another.
 */
export const dynamic = "force-dynamic";

type Stats = {
  present: number;
  late: number;
  absent: number;
  excused: number;
  submitted: number;
  unsubmitted_scheduled: number;
};

type Result = {
  exam_id: string;
  exam_name: string;
  term_name: string;
  percentage: string;
  gpa: string | null;
  grade: string | null;
  is_pass: boolean;
  position_in_class: number | null;
  published_at: string;
};

type FeedbackTarget = { answered_at: string | null };

export default async function StudentHome() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const today = schoolToday();
  const { from, to } = monthBounds(today);

  /*
   * RLS limits every one of these to this student's own rows. A filter by id
   * is unnecessary here, and its absence is the point: there is no id in the
   * URL that could be changed to reach someone else.
   */
  const [student, enrollment, fees, campaign] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, registration_no, full_name, gender, blood_group, date_of_birth, photo_path",
      )
      .maybeSingle(),
    supabase
      .from("student_enrollments")
      .select("roll_no, classes(name), sections(name), academic_years(name)")
      .eq("status", "active")
      .maybeSingle(),
    supabase.from("fee_charges").select("amount, amount_paid, discount_amount, status"),
    supabase
      .from("feedback_campaigns")
      .select("id, name, blocks_admit_card, closes_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!student.data) {
    return (
      <PortalShell
        portalName="Student portal"
        userName={profile?.full_name ?? "Student"}
        nav={STUDENT_NAV}
      >
        <PageSections>
          <PageHeader title="My profile" />
          <Card padded={false}>
            <EmptyState icon="profile" title="This account is not linked to a student record">
              Your sign-in works, but no student record is attached to it yet, so
              there is nothing to show. The school office links the two.
            </EmptyState>
          </Card>
        </PageSections>
      </PortalShell>
    );
  }

  const studentId = student.data.id;

  const [stats, results, forms] = await Promise.all([
    supabase.rpc("student_attendance_stats", {
      p_student_id: studentId,
      p_from: from,
      p_to: to,
    }),
    supabase.rpc("student_results", { p_student_id: studentId }),
    campaign.data
      ? supabase.rpc("student_feedback_forms", { p_campaign_id: campaign.data.id })
      : Promise.resolve({ data: [] as FeedbackTarget[] }),
  ]);

  const attendance = (stats.data ?? {
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    submitted: 0,
    unsubmitted_scheduled: 0,
  }) as Stats;

  // Published results only — a draft result is never visible here, and the RPC
  // enforces that rather than this page filtering it.
  const published = (results.data ?? []) as Result[];
  const latest = published[0];

  const targets = (forms.data ?? []) as FeedbackTarget[];
  const feedbackPending = targets.filter((t) => t.answered_at === null).length;

  const charges = fees.data ?? [];
  const unpaid = charges.filter((c) => c.status === "pending" || c.status === "partial");
  const outstanding = unpaid.reduce(
    (sum, c) => sum + (Number(c.amount) - Number(c.amount_paid) - Number(c.discount_amount)),
    0,
  );

  const cls = one<{ name: string }>(enrollment.data?.classes);
  const sec = one<{ name: string }>(enrollment.data?.sections);
  const year = one<{ name: string }>(enrollment.data?.academic_years);

  const period = monthLabel(today);
  const name = student.data.full_name ?? profile?.full_name ?? "Student";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0])
    .join("")
    .toUpperCase();

  return (
    <PortalShell
      portalName="Student portal"
      userName={profile?.full_name ?? "Student"}
      nav={STUDENT_NAV}
    >
      <PageSections>
        <PageHeader
          title={name}
          meta={
            <>
              {cls?.name ?? "Not placed in a class"}
              {sec?.name && ` — Section ${sec.name}`}
              {enrollment.data?.roll_no && ` · Roll ${enrollment.data.roll_no}`}
              {year?.name && ` · ${year.name}`}
            </>
          }
          actions={
            <>
              <NavButton href="/student/results" icon="chart">
                My results
              </NavButton>
              <NavButton href="/student/documents" tone="primary" icon="card">
                ID &amp; admit card
              </NavButton>
            </>
          }
        />

        {/* The one thing on this page that is a deadline rather than a record:
            an unfinished feedback round can hold back an admit card, so it is
            said first and in the student's own terms. */}
        {campaign.data && feedbackPending > 0 && (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">
                  {feedbackPending} teacher{feedbackPending === 1 ? "" : "s"} still
                  need your feedback
                </h2>
                <p
                  className="mt-1.5 max-w-prose text-sm leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {campaign.data.name}
                  {campaign.data.closes_at &&
                    ` closes ${longDate(campaign.data.closes_at.slice(0, 10))}`}
                  .{" "}
                  {campaign.data.blocks_admit_card
                    ? "Your admit card cannot be issued until all of it is done."
                    : "It is not required for your admit card, but your teachers read it."}{" "}
                  Teachers never see who answered.
                </p>
              </div>
              <NavButton href="/student/feedback" tone="primary" icon="feedback">
                Give feedback
              </NavButton>
            </div>
          </Card>
        )}

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            label="Attendance"
            value={
              attendance.submitted > 0
                ? `${Math.round(((attendance.present + attendance.late) / attendance.submitted) * 100)}%`
                : "—"
            }
            detail={
              attendance.submitted > 0
                ? `${attendance.present + attendance.late} of ${attendance.submitted} lessons · ${period}`
                : `no lessons submitted yet in ${period}`
            }
            tone="info"
            icon="check"
          />
          <StatCard
            label="Outstanding fees"
            value={`৳${outstanding.toLocaleString("en-US")}`}
            detail={
              unpaid.length === 0
                ? "nothing unpaid"
                : `across ${unpaid.length} unpaid charge${unpaid.length === 1 ? "" : "s"}`
            }
            tone={outstanding > 0 ? "warn" : "good"}
            icon="money"
          />
          <StatCard
            label="Published results"
            value={published.length}
            detail={
              latest
                ? `latest: ${latest.exam_name}`
                : "no result has been published yet"
            }
            tone="accent"
            icon="chart"
          />
          <StatCard
            label="Feedback to give"
            value={feedbackPending}
            detail={
              campaign.data
                ? `${campaign.data.name}`
                : "no feedback round is open"
            }
            tone={feedbackPending > 0 ? "warn" : "good"}
            icon="feedback"
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          {/* ---- Profile card ------------------------------------------- */}
          <Card className="lg:col-span-2">
            <div className="flex items-start gap-4">
              <span
                aria-hidden="true"
                className="grid h-16 w-16 shrink-0 place-items-center text-xl font-semibold"
                style={{
                  borderRadius: "var(--radius-card)",
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                }}
              >
                {initials || "?"}
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">{name}</h2>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  {student.data.photo_path
                    ? "Photo on file — it prints on your ID and admit card."
                    : "No photo on file. Your ID card prints without one until the office uploads it."}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <FieldList
                columns={3}
                items={[
                  {
                    label: "Registration No",
                    value: student.data.registration_no ?? "—",
                    numeric: true,
                  },
                  {
                    label: "Roll",
                    value: enrollment.data?.roll_no ?? "—",
                    numeric: true,
                  },
                  { label: "Class", value: cls?.name ?? "—" },
                  { label: "Section", value: sec?.name ?? "—" },
                  { label: "Academic year", value: year?.name ?? "—" },
                  { label: "Blood group", value: student.data.blood_group ?? "—" },
                  {
                    label: "Date of birth",
                    value: student.data.date_of_birth ?? "—",
                    numeric: true,
                  },
                  {
                    label: "Gender",
                    value: student.data.gender ?? "—",
                  },
                ]}
              />
            </div>
          </Card>

          {/* ---- Attendance ring ---------------------------------------- */}
          <Card>
            <RingMeter
              value={attendance.present + attendance.late}
              denominator={attendance.submitted}
              label="My attendance"
              period={period}
            />
            <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Counted from lessons a teacher actually submitted. A lesson nobody
              submitted is excluded, not counted against you
              {attendance.unsubmitted_scheduled > 0 &&
                ` — ${attendance.unsubmitted_scheduled} scheduled lesson${attendance.unsubmitted_scheduled === 1 ? " is" : "s are"} still unsubmitted this month`}
              .
            </p>
            <p className="mt-4">
              <NavButton href="/student/attendance" icon="check">
                Month by month
              </NavButton>
            </p>
          </Card>
        </section>

        {/* ---- Latest result ---------------------------------------------- */}
        <Card padded={latest ? true : false}>
          {latest ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">
                    {latest.exam_name}
                    <span className="font-normal" style={{ color: "var(--text-muted)" }}>
                      {" "}
                      · {latest.term_name}
                    </span>
                  </h2>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    Published {longDate(latest.published_at.slice(0, 10))}
                  </p>
                </div>
                <Status tone={latest.is_pass ? "good" : "bad"}>
                  {latest.is_pass ? "passed" : "not passed"}
                </Status>
              </div>

              <div className="mt-4">
                <FieldList
                  columns={3}
                  items={[
                    {
                      label: "Marks",
                      value: `${Number(latest.percentage).toFixed(2)}%`,
                      numeric: true,
                    },
                    {
                      label: "GPA",
                      value: latest.gpa ? Number(latest.gpa).toFixed(2) : "—",
                      numeric: true,
                    },
                    { label: "Grade", value: latest.grade ?? "—" },
                    {
                      label: "Position in class",
                      value: latest.position_in_class ?? "not ranked",
                      numeric: latest.position_in_class !== null,
                    },
                  ]}
                />
              </div>

              <p className="mt-5">
                <NavButton href="/student/results" icon="chart">
                  Every subject, and my other exams
                </NavButton>
              </p>
            </>
          ) : (
            <>
              <CardHeader title="My latest result" hint="Results appear here once the school publishes them." />
              <EmptyState icon="chart" title="No result has been published yet">
                A result stays private to the school office while marks are being
                entered and checked. When your exam is published, its summary
                appears here and the full sheet on the results page.
              </EmptyState>
            </>
          )}
        </Card>

        <Card>
          <h2 className="text-sm font-semibold">About SMS</h2>
          <p
            className="mt-1.5 text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            Messages to your guardian&rsquo;s phone are a development simulation:
            attendance summaries, result notices and sign-in codes are written and
            recorded, but none is delivered, because no SMS provider is connected
            yet. The fingerprint attendance machine is not in use either.
          </p>
        </Card>
      </PageSections>
    </PortalShell>
  );
}
