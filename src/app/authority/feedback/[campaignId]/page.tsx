import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../../nav";
import { BarSeries, Pill, RingMeter, StatCard, type BarDatum } from "@/components/charts";
import { CampaignStatusControl, TargetGenerator } from "../campaign-forms";
import { one } from "@/lib/supabase/relations";

export const metadata: Metadata = { title: "Feedback round" };
export const dynamic = "force-dynamic";

type Analysis = {
  teacher_id: string;
  teacher_name: string;
  question_id: string;
  prompt: string;
  response_count: number;
  average_rating: string;
  below_sample_floor: boolean;
};

type Completion = {
  student_id: string;
  full_name: string;
  registration_no: string;
  class_name: string;
  section_name: string | null;
  roll_no: number;
  targets_total: number;
  targets_done: number;
  completed_at: string | null;
};

export default async function FeedbackCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { campaignId } = await params;
  const { show = "analysis" } = await searchParams;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const { data: campaign } = await supabase
    .from("feedback_campaigns")
    .select("id, name, status, opens_at, closes_at, blocks_admit_card, min_periods_taught, terms(name)")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign) notFound();

  const [questions, analysis, comments, completions] = await Promise.all([
    supabase
      .from("feedback_questions")
      .select("id, prompt, prompt_bn, order_no, scale_min, scale_max")
      .eq("campaign_id", campaignId)
      .order("order_no"),
    supabase.rpc("feedback_analysis", { p_campaign_id: campaignId, p_min_responses: 3 }),
    supabase
      .from("feedback_comments")
      .select("id, body, submitted_on, teachers(full_name), subjects(name), sections(name)")
      .eq("campaign_id", campaignId)
      .order("submitted_on", { ascending: false }),
    supabase.rpc("feedback_completion_overview", {
      p_campaign_id: campaignId,
      p_class_id: null,
    }),
  ]);

  const rows = (analysis.data ?? []) as Analysis[];
  const completionRows = (completions.data ?? []) as Completion[];

  const forms = completionRows.reduce((n, r) => n + r.targets_total, 0);
  const finished = completionRows.filter((r) => r.completed_at !== null).length;
  const started = completionRows.filter((r) => r.targets_done > 0).length;

  /*
   * The denominator is the students who actually HAVE forms, not every enrolled
   * student. The overview lists everyone so the office can see who was left out
   * — a class whose teachers taught too few lessons — but counting those
   * students as unfinished would read as "0 of 5 owe us feedback" when two of
   * them owe nothing at all.
   */
  const owing = completionRows.filter((r) => r.targets_total > 0);
  const withoutForms = completionRows.length - owing.length;
  const scaleMax = (questions.data ?? [])[0]?.scale_max ?? 5;

  // Grouped per teacher so a reader sees one teacher's whole picture at once.
  const byTeacher = new Map<string, Analysis[]>();
  for (const row of rows) {
    const list = byTeacher.get(row.teacher_id);
    if (list) list.push(row);
    else byTeacher.set(row.teacher_id, [row]);
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
        <nav aria-label="Breadcrumb" className="text-xs">
          <Link
            href={"/authority/feedback" as never}
            className="underline"
            style={{ color: "var(--text-muted)" }}
          >
            Teacher feedback
          </Link>
        </nav>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {one<{ name: string }>(campaign.terms)?.name}
              {campaign.opens_at &&
                ` · opens ${new Date(campaign.opens_at).toLocaleDateString("en-GB")}`}
              {campaign.closes_at &&
                ` · closes ${new Date(campaign.closes_at).toLocaleDateString("en-GB")}`}
            </p>
          </div>
          <Pill tone={campaign.status === "open" ? "warn" : "neutral"}>{campaign.status}</Pill>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 p-4" style={cardStyle}>
            <RingMeter
              value={finished}
              denominator={owing.length}
              label="Students finished"
              period={`${started} of ${owing.length} have started`}
            />
            {withoutForms > 0 && (
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                {withoutForms} enrolled student{withoutForms === 1 ? " has" : "s have"} no
                forms in this round, so {withoutForms === 1 ? "it is" : "they are"} not
                counted above. Their teachers taught fewer than the minimum lessons.
              </p>
            )}
          </div>
          <StatCard
            label="Forms"
            value={forms}
            detail={`across ${owing.length} student${owing.length === 1 ? "" : "s"}`}
            tone="neutral"
          />
          <StatCard
            label="Ratings received"
            value={rows.reduce((n, r) => n + Number(r.response_count), 0)}
            detail={`${byTeacher.size} teacher${byTeacher.size === 1 ? "" : "s"} rated`}
            tone="accent"
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="p-4" style={cardStyle}>
            <CampaignStatusControl campaignId={campaign.id} current={campaign.status} />
          </section>
          <section className="p-4" style={cardStyle}>
            <TargetGenerator campaignId={campaign.id} formCount={forms} />
          </section>
        </div>

        {/* --- tabs --------------------------------------------------------- */}
        <nav aria-label="Choose a view" className="flex flex-wrap gap-1">
          {[
            ["analysis", "Ratings"],
            ["comments", `Comments (${(comments.data ?? []).length})`],
            ["completion", "Who has finished"],
          ].map(([key, label]) => {
            const active = show === key;
            return (
              <Link
                key={key}
                href={{
                  pathname: `/authority/feedback/${campaign.id}`,
                  query: { show: key },
                }}
                aria-current={active ? "page" : undefined}
                className="px-3 py-1.5 text-sm font-medium"
                style={{
                  borderRadius: "var(--radius-control)",
                  background: active ? "var(--accent)" : "var(--surface-raised)",
                  color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--line-hairline)"}`,
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* --- ratings ------------------------------------------------------ */}
        {show === "analysis" && (
          <section className="space-y-4">
            {rows.length === 0 ? (
              <div className="p-8 text-center" style={cardStyle}>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  No ratings yet.
                </p>
              </div>
            ) : (
              [...byTeacher.entries()].map(([teacherId, teacherRows]) => {
                const name = teacherRows[0]!.teacher_name;
                const small = teacherRows.some((r) => r.below_sample_floor);

                const data: BarDatum[] = teacherRows.map((r) => ({
                  label: r.prompt.slice(0, 18),
                  value: Number(r.average_rating),
                  display: `${Number(r.average_rating).toFixed(2)} / ${scaleMax}`,
                  tone:
                    Number(r.average_rating) >= scaleMax * 0.8
                      ? "good"
                      : Number(r.average_rating) >= scaleMax * 0.6
                        ? "accent"
                        : "warn",
                }));

                const responses = Math.max(
                  ...teacherRows.map((r) => Number(r.response_count)),
                );

                return (
                  <div key={teacherId} className="p-4" style={cardStyle}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{name}</h3>
                      {small && <Pill tone="warn">Small sample</Pill>}
                    </div>

                    <BarSeries
                      data={data}
                      total={responses}
                      caption="Average rating per question"
                      period={`${responses} response${responses === 1 ? "" : "s"}`}
                    />

                    {/* The full prompts, since the bars are abbreviated. */}
                    <ul className="mt-3 space-y-1">
                      {teacherRows.map((r) => (
                        <li key={r.question_id} className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.prompt} — {Number(r.average_rating).toFixed(2)} from{" "}
                          {r.response_count} response{Number(r.response_count) === 1 ? "" : "s"}
                        </li>
                      ))}
                    </ul>

                    {small && (
                      <p className="mt-3 text-xs" style={{ color: "var(--state-warn)" }}>
                        Fewer than three responses. With a sample this small an
                        average can effectively identify who answered, so treat
                        it as an impression rather than a measurement.
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </section>
        )}

        {/* --- comments ----------------------------------------------------- */}
        {show === "comments" && (
          <section style={cardStyle} className="overflow-hidden">
            <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
              <h2 className="text-sm font-semibold">Comments</h2>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                Anonymous by construction. Only the date is stored, not the time,
                so the order they arrived in cannot be matched against who
                finished when.
              </p>
            </header>

            {(comments.data ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No comments yet.
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
                {(comments.data ?? []).map((c) => (
                  <li key={c.id} className="px-4 py-3">
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      About {one<{ full_name: string }>(c.teachers)?.full_name ?? "a teacher"}
                      {one<{ name: string }>(c.subjects)?.name &&
                        ` · ${one<{ name: string }>(c.subjects)!.name}`}
                      {one<{ name: string }>(c.sections)?.name &&
                        ` · section ${one<{ name: string }>(c.sections)!.name}`}
                      {` · ${c.submitted_on}`}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* --- completion --------------------------------------------------- */}
        {show === "completion" && (
          <section style={cardStyle} className="overflow-hidden">
            <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
              <h2 className="text-sm font-semibold">
                Who has finished
                <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
                  unfinished first
                </span>
              </h2>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                Names are safe here precisely because this table holds no
                answers. It says who still owes feedback, which is what blocks an
                admit card, and nothing about what anyone said.
              </p>
            </header>

            {completionRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No forms have been generated yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Feedback completion by student</caption>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                      <th scope="col" className="px-4 py-2 text-left font-semibold">Student</th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">Class</th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">Done</th>
                      <th scope="col" className="px-4 py-2 text-right font-semibold">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...completionRows]
                      .sort(
                        (a, b) =>
                          Number(a.completed_at !== null) - Number(b.completed_at !== null) ||
                          a.class_name.localeCompare(b.class_name) ||
                          a.roll_no - b.roll_no,
                      )
                      .map((r) => (
                        <tr key={r.student_id} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                          <td className="px-4 py-2">
                            <span className="block font-medium">{r.full_name}</span>
                            <span className="numeric block text-xs" style={{ color: "var(--text-muted)" }}>
                              {r.registration_no} · roll {r.roll_no}
                            </span>
                          </td>
                          <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                            {r.class_name}
                            {r.section_name && ` — ${r.section_name}`}
                          </td>
                          <td className="numeric px-3 py-2 text-right">
                            {r.targets_done} / {r.targets_total}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.completed_at ? (
                              <Pill tone="good">Finished</Pill>
                            ) : r.targets_total === 0 ? (
                              <Pill tone="neutral">No forms</Pill>
                            ) : r.targets_done > 0 ? (
                              <Pill tone="warn">Part done</Pill>
                            ) : (
                              <Pill tone="bad">Not started</Pill>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </PortalShell>
  );
}
