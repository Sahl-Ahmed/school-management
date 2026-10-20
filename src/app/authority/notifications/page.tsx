import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { Banner } from "@/components/form";
import { Pill, StatCard } from "@/components/charts";
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

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "accent"> = {
  sent: "good",
  pending: "warn",
  queued: "accent",
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

  const cardStyle = {
    borderRadius: "var(--radius-card)",
    background: "var(--surface-raised)",
    border: "1px solid var(--line-hairline)",
    boxShadow: "var(--shadow-card)",
  } as const;

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Messages, the queue behind them, and what they would cost
          </p>
        </header>

        {/* Stated once at the top and again on every outcome, because this is
            the thing most likely to be misread on this page. */}
        <Banner tone="warning">{SIMULATION_BANNER}</Banner>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Waiting to dispatch"
            value={pending}
            detail="queued or scheduled"
            tone={pending > 0 ? "warn" : "good"}
          />
          <StatCard
            label="Billable segments"
            value={totalSegments}
            detail="across every message ever queued"
            tone="neutral"
          />
          <StatCard
            label="Simulated sends"
            value={simulatedSends}
            detail={liveSends > 0 ? `${liveSends} live` : "no live sends at all"}
            tone="neutral"
          />
          <StatCard
            label="Failures"
            value={failures}
            detail={failures > 0 ? "see the delivery log" : "none"}
            tone={failures > 0 ? "bad" : "good"}
          />
        </section>

        {/* --- queueing ---------------------------------------------------- */}
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="p-4" style={cardStyle}>
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
          </section>

          <section className="p-4" style={cardStyle}>
            <ResultQueuer
              exams={(exams.data ?? []).map((e) => ({
                id: e.id,
                label: `${e.name}${one<{ name: string }>(e.terms)?.name ? ` — ${one<{ name: string }>(e.terms)!.name}` : ""}`,
                published: e.results_published_at !== null,
              }))}
            />
          </section>
        </div>

        <section className="p-4" style={cardStyle}>
          <Dispatcher pending={pending} />
        </section>

        {/* --- the queue --------------------------------------------------- */}
        <section className="overflow-hidden" style={cardStyle}>
          <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
            <h2 className="text-sm font-semibold">The queue, by message type</h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              A simulated dispatch settles as <strong>skipped</strong>, not sent.
              Nothing here claims a delivery that did not happen.
            </p>
          </header>

          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Nothing has been queued yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Notification jobs by type and status</caption>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">Type</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Status</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Messages</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Segments</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">In Bangla</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.type}-${r.status}`} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                      <td className="px-4 py-2">{TYPE_WORDS[r.type] ?? r.type}</td>
                      <td className="px-3 py-2">
                        <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Pill>
                      </td>
                      <td className="numeric px-3 py-2 text-right">{Number(r.jobs)}</td>
                      <td className="numeric px-3 py-2 text-right">{Number(r.segments)}</td>
                      <td className="numeric px-3 py-2 text-right">{Number(r.unicode_jobs)}</td>
                      <td className="px-4 py-2 text-right">
                        {(r.status === "pending" || r.status === "queued") && (
                          <QueueCanceller
                            type={r.type}
                            count={pendingByType.get(r.type) ?? 0}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* --- the messages themselves ------------------------------------- */}
        <section className="overflow-hidden" style={cardStyle}>
          <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
            <h2 className="text-sm font-semibold">Message wording</h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              Edit these freely — they are configuration. The{" "}
              <code>{"{braces}"}</code> are filled in per student when the
              message is built.
            </p>
          </header>

          <div className="space-y-4 p-4">
            {[...byType.entries()].map(([type, list]) => (
              <div key={type}>
                <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  {TYPE_WORDS[type] ?? type}
                </h3>
                <div className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
                  {list.map((t) => (
                    <TemplateEditor key={t.id} template={t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* --- recent messages -------------------------------------------- */}
        <section className="overflow-hidden" style={cardStyle}>
          <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
            <h2 className="text-sm font-semibold">
              Recent messages
              <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
                newest first
              </span>
            </h2>
          </header>

          {(recentJobs.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Nothing yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
              {(recentJobs.data ?? []).map((j) => (
                <li key={j.id} className="px-4 py-3">
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
                      <Pill tone={STATUS_TONE[j.status] ?? "neutral"}>{j.status}</Pill>
                    </span>
                  </div>

                  {j.body && <p className="mt-1.5 text-sm">{j.body}</p>}

                  {j.last_error && (
                    <p
                      className="mt-1.5 rounded px-2 py-1 text-xs"
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
        </section>

        {/* --- delivery log ----------------------------------------------- */}
        <section className="overflow-hidden" style={cardStyle}>
          <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
            <h2 className="text-sm font-semibold">Delivery log</h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              One row per dispatch attempt. <strong>simulate</strong> means
              nothing was contacted.
            </p>
          </header>

          {(logs.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No attempts yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">SMS delivery attempts</caption>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">When</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Mode</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Status</th>
                    <th scope="col" className="px-3 py-2 text-right font-semibold">Segments</th>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {(logs.data ?? []).map((l) => (
                    <tr key={l.id} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                      <td className="numeric px-4 py-2">
                        {new Date(l.attempted_at).toLocaleString("en-GB")}
                      </td>
                      <td className="px-3 py-2">
                        <Pill tone={l.mode === "live" ? "accent" : "neutral"}>{l.mode}</Pill>
                      </td>
                      <td className="px-3 py-2">
                        <Pill tone={l.status === "failed" ? "bad" : l.status === "sent" ? "good" : "neutral"}>
                          {l.status ?? "—"}
                        </Pill>
                      </td>
                      <td className="numeric px-3 py-2 text-right">{l.segments ?? "—"}</td>
                      <td className="px-4 py-2 text-xs" style={{ color: "var(--state-bad)" }}>
                        {l.error_message ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PortalShell>
  );
}
