import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { Banner } from "@/components/form";
import { StatCard } from "@/components/charts";
import {
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  PageHeader,
  PageSections,
  Status,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import {
  DailyAttendanceQueuer,
  Dispatcher,
  QueueCanceller,
  ResultQueuer,
  TemplateEditor,
  type TemplateRow,
} from "./notification-forms";
import { SIMULATION_BANNER } from "./copy";
import { one } from "@/lib/supabase/relations";
import { schoolToday } from "@/lib/school/calendar";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

type Overview = {
  type: string;
  status: string;
  jobs: number;
  segments: number;
  unicode_jobs: number;
  simulated_sends: number;
  live_sends: number;
  failures: number;
};

const TYPE_WORDS: Record<string, string> = {
  daily_attendance: "Daily attendance",
  exam_result: "Published results",
  class_test_result: "Class test results",
  account_otp: "Account codes",
  attendance_correction: "Attendance corrections",
  custom: "Other",
};

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "info"> = {
  sent: "good",
  pending: "warn",
  queued: "info",
  failed: "bad",
  cancelled: "neutral",
  skipped: "neutral",
};

export default async function NotificationsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const [overview, settings, exams, templates, recentJobs, logs] = await Promise.all([
    supabase.rpc("notification_overview", { p_from: null, p_to: null }),
    supabase
      .from("school_settings")
      .select("daily_sms_enabled, daily_sms_grace_minutes, daily_sms_earliest_time")
      .maybeSingle(),
    supabase
      .from("exams")
      .select("id, name, results_published_at, terms(name)")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("notification_templates")
      .select("id, type, language, name, body")
      .eq("is_active", true)
      .order("type")
      .order("language"),
    supabase
      .from("notification_jobs")
      .select("id, type, status, target_phone, body, segments, is_unicode, job_date, scheduled_for, last_error, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("sms_delivery_logs")
      .select("id, job_id, mode, status, error_message, segments, attempted_at, provider")
      .order("attempted_at", { ascending: false })
      .limit(40),
  ]);

  const rows = (overview.data ?? []) as Overview[];

  const pending = rows
    .filter((r) => r.status === "pending" || r.status === "queued")
    .reduce((n, r) => n + Number(r.jobs), 0);
  const totalSegments = rows.reduce((n, r) => n + Number(r.segments), 0);
  const failures = rows.reduce((n, r) => n + Number(r.failures), 0);
  const simulatedSends = rows.reduce((n, r) => n + Number(r.simulated_sends), 0);
  const liveSends = rows.reduce((n, r) => n + Number(r.live_sends), 0);

  // Queue depth per type, for the cancel controls.
  const pendingByType = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "pending" || r.status === "queued") {
      pendingByType.set(r.type, (pendingByType.get(r.type) ?? 0) + Number(r.jobs));
    }
  }

  const templateRows = (templates.data ?? []) as TemplateRow[];
  const byType = new Map<string, TemplateRow[]>();
  for (const t of templateRows) {
    const list = byType.get(t.type);
    if (list) list.push(t);
    else byType.set(t.type, [t]);
  }

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          title="Notifications"
          meta="Messages, the queue behind them, and what they would cost"
          description="Every figure below counts real rows in the queue. None of them is a delivery."
        />

        {/* Stated once at the top and again on every outcome, because this is
            the thing most likely to be misread on this page. */}
        <Banner tone="warning">{SIMULATION_BANNER}</Banner>

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            label="Waiting to dispatch"
            value={pending}
            detail="queued or scheduled"
            tone={pending > 0 ? "warn" : "good"}
            icon="bell"
          />
          <StatCard
            label="Billable segments"
            value={totalSegments}
            detail="across every message ever queued"
            tone="neutral"
            icon="money"
          />
          <StatCard
            label="Simulated sends"
            value={simulatedSends}
            detail={liveSends > 0 ? `${liveSends} live` : "no live sends at all"}
            tone="info"
            icon="clipboard"
          />
          <StatCard
            label="Failures"
            value={failures}
            detail={failures > 0 ? "see the delivery log" : "none"}
            tone={failures > 0 ? "bad" : "good"}
            icon="bell"
          />
        </section>

        {/* --- queueing ---------------------------------------------------- */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <DailyAttendanceQueuer
              today={schoolToday()}
              enabled={Boolean(settings.data?.daily_sms_enabled)}
            />
            {settings.data && (
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Scheduled for {settings.data.daily_sms_grace_minutes} minutes after
                the last lesson ends, and never before{" "}
                {String(settings.data.daily_sms_earliest_time).slice(0, 5)}. Both
                are school settings, not fixed in code.
              </p>
            )}
          </Card>

          <Card>
            <ResultQueuer
              exams={(exams.data ?? []).map((e) => ({
                id: e.id,
                label: `${e.name}${one<{ name: string }>(e.terms)?.name ? ` — ${one<{ name: string }>(e.terms)!.name}` : ""}`,
                published: e.results_published_at !== null,
              }))}
            />
          </Card>
        </div>

        <Card>
          <Dispatcher pending={pending} />
        </Card>

        {/* --- the queue --------------------------------------------------- */}
        <Card padded={false}>
          <CardHeader
            title="The queue, by message type"
            hint={
              <>
                A simulated dispatch settles as <strong>skipped</strong>, not
                sent. Nothing here claims a delivery that did not happen.
              </>
            }
          />

          {rows.length === 0 ? (
            <EmptyState icon="bell" title="Nothing has been queued yet">
              Queue a daily attendance summary or a published result above, and
              each message appears here with its billable segment count before
              anything is dispatched.
            </EmptyState>
          ) : (
            <DataTable
              caption="Notification jobs by type and status"
              head={
                <>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th align="right">Messages</Th>
                  <Th align="right">Segments</Th>
                  <Th align="right">In Bangla</Th>
                  <Th align="right">Action</Th>
                </>
              }
            >
              {rows.map((r) => (
                <Tr key={`${r.type}-${r.status}`}>
                  <Td>
                    <span className="font-medium">{TYPE_WORDS[r.type] ?? r.type}</span>
                  </Td>
                  <Td>
                    <Status tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Status>
                  </Td>
                  <Td numeric>{Number(r.jobs)}</Td>
                  <Td numeric>{Number(r.segments)}</Td>
                  <Td numeric>{Number(r.unicode_jobs)}</Td>
                  <Td align="right">
                    {(r.status === "pending" || r.status === "queued") && (
                      <QueueCanceller
                        type={r.type}
                        count={pendingByType.get(r.type) ?? 0}
                      />
                    )}
                  </Td>
                </Tr>
              ))}
            </DataTable>
          )}
        </Card>

        {/* --- the messages themselves ------------------------------------- */}
        <Card padded={false}>
          <CardHeader
            title="Message wording"
            hint={
              <>
                Edit these freely — they are configuration. The{" "}
                <code>{"{braces}"}</code> are filled in per student when the
                message is built, and the editor shows what each wording costs
                per message before you save it.
              </>
            }
          />

          <CardBody className="space-y-6">
            {[...byType.entries()].map(([type, list]) => (
              <div key={type}>
                <h3
                  className="text-xs font-semibold uppercase tracking-[0.04em]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {TYPE_WORDS[type] ?? type}
                </h3>
                <div className="divide-y" style={{ borderColor: "var(--line-on-white)" }}>
                  {list.map((t) => (
                    <TemplateEditor key={t.id} template={t} />
                  ))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        {/* --- recent messages -------------------------------------------- */}
        <Card padded={false}>
          <CardHeader
            title="Recent messages"
            hint="Newest first, with the exact text that was built for each guardian. Phone numbers are shown partly masked."
          />

          {(recentJobs.data ?? []).length === 0 ? (
            <EmptyState icon="bell" title="No message has been built yet">
              Each queued message is rendered in full here, so the office can
              read what a guardian would receive before anything is dispatched.
            </EmptyState>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line-on-white)" }}>
              {(recentJobs.data ?? []).map((j) => (
                <li key={j.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {TYPE_WORDS[j.type] ?? j.type}
                      {j.job_date && ` · ${j.job_date}`}
                      {" · "}
                      {/* The number is shown partly masked: the office needs to
                          recognise it, not to read it out of a log. */}
                      {String(j.target_phone).slice(0, 7)}xxxxx
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {j.segments != null && (
                        <span className="numeric text-xs" style={{ color: "var(--text-muted)" }}>
                          {j.segments} segment{j.segments === 1 ? "" : "s"}
                          {j.is_unicode && " · Bangla"}
                        </span>
                      )}
                      <Status tone={STATUS_TONE[j.status] ?? "neutral"}>{j.status}</Status>
                    </span>
                  </div>

                  {j.body && <p className="mt-2 text-sm leading-relaxed">{j.body}</p>}

                  {j.last_error && (
                    <p
                      className="mt-2 rounded-[var(--radius-data)] px-2.5 py-1.5 text-xs"
                      style={{
                        background: j.status === "failed"
                          ? "var(--state-bad-soft)"
                          : "var(--surface-sunken)",
                        color: j.status === "failed"
                          ? "var(--state-bad)"
                          : "var(--text-muted)",
                      }}
                    >
                      {j.last_error}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --- delivery log ----------------------------------------------- */}
        <Card padded={false}>
          <CardHeader
            title="Delivery log"
            hint={
              <>
                One row per dispatch attempt. <strong>simulate</strong> means
                nothing was contacted — no provider, no phone, no charge.
              </>
            }
          />

          {(logs.data ?? []).length === 0 ? (
            <EmptyState icon="bell" title="No dispatch has been attempted yet">
              Running the dispatcher writes one row here per attempt, including
              the failures, so a message that did not arrive can be traced.
            </EmptyState>
          ) : (
            <DataTable
              caption="SMS delivery attempts"
              head={
                <>
                  <Th>When</Th>
                  <Th>Mode</Th>
                  <Th>Status</Th>
                  <Th align="right">Segments</Th>
                  <Th>Problem</Th>
                </>
              }
            >
              {(logs.data ?? []).map((l) => (
                <Tr key={l.id}>
                  <Td numeric align="left">
                    {new Date(l.attempted_at).toLocaleString("en-GB")}
                  </Td>
                  <Td>
                    <Status tone={l.mode === "live" ? "info" : "neutral"}>{l.mode}</Status>
                  </Td>
                  <Td>
                    <Status
                      tone={
                        l.status === "failed" ? "bad" : l.status === "sent" ? "good" : "neutral"
                      }
                    >
                      {l.status ?? "—"}
                    </Status>
                  </Td>
                  <Td numeric>{l.segments ?? "—"}</Td>
                  <Td>
                    <span className="text-xs" style={{ color: "var(--state-bad)" }}>
                      {l.error_message ?? ""}
                    </span>
                  </Td>
                </Tr>
              ))}
            </DataTable>
          )}
        </Card>
      </PageSections>
    </PortalShell>
  );
}
