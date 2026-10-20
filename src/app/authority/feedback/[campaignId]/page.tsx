import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../../nav";
import { BarSeries, RingMeter, StatCard, type BarDatum } from "@/components/charts";
import {
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  FilterChips,
  PageHeader,
  PageSections,
  Status,
  Td,
  Th,
  Tr,
} from "@/components/ui";
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

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          breadcrumb={{ label: "Teacher feedback", href: "/authority/feedback" }}
          title={campaign.name}
          meta={
            <>
              {one<{ name: string }>(campaign.terms)?.name}
              {campaign.opens_at &&
                ` · opens ${new Date(campaign.opens_at).toLocaleDateString("en-GB")}`}
              {campaign.closes_at &&
                ` · closes ${new Date(campaign.closes_at).toLocaleDateString("en-GB")}`}
            </>
          }
          actions={
            <Status tone={campaign.status === "open" ? "warn" : "neutral"} dot>
              {campaign.status}
            </Status>
          }
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Card className="col-span-2">
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
          </Card>
          <StatCard
            label="Forms"
            value={forms}
            detail={`across ${owing.length} student${owing.length === 1 ? "" : "s"}`}
            tone="neutral"
            icon="clipboard"
          />
          <StatCard
            label="Ratings received"
            value={rows.reduce((n, r) => n + Number(r.response_count), 0)}
            detail={`${byTeacher.size} teacher${byTeacher.size === 1 ? "" : "s"} rated`}
            tone="info"
            icon="feedback"
          />
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CampaignStatusControl campaignId={campaign.id} current={campaign.status} />
          </Card>
          <Card>
            <TargetGenerator campaignId={campaign.id} formCount={forms} />
          </Card>
        </div>

        {/* --- tabs --------------------------------------------------------- */}
        <FilterChips
          label="Choose a view"
          options={[
            ["analysis", "Ratings"],
            ["comments", `Comments (${(comments.data ?? []).length})`],
            ["completion", "Who has finished"],
          ].map(([key, label]) => ({
            href: {
              pathname: `/authority/feedback/${campaign.id}` as Route,
              query: { show: key },
            },
            label: label!,
            active: show === key,
          }))}
        />

        {/* --- ratings ------------------------------------------------------ */}
        {show === "analysis" && (
          <section className="space-y-4">
            {rows.length === 0 ? (
              <Card padded={false}>
                <EmptyState icon="feedback" title="No rating has been submitted yet">
                  Ratings appear here as students complete their forms. With no
                  answers in, there is nothing to average — and a zero would be a
                  measurement, which this is not.
                </EmptyState>
              </Card>
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
                        ? "info"
                        : "warn",
                }));

                const responses = Math.max(
                  ...teacherRows.map((r) => Number(r.response_count)),
                );

                return (
                  <Card key={teacherId}>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{name}</h3>
                      {small && <Status tone="warn">small sample</Status>}
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
                  </Card>
                );
              })
            )}
          </section>
        )}

        {/* --- comments ----------------------------------------------------- */}
        {show === "comments" && (
          <Card padded={false}>
            <CardHeader
              title="Comments"
              hint="Anonymous by construction. Only the date is stored, not the time, so the order they arrived in cannot be matched against who finished when."
            />

            {(comments.data ?? []).length === 0 ? (
              <EmptyState icon="feedback" title="No comment has been written yet">
                A comment is optional on every form, so a round can finish
                without any. The ratings view still shows what was scored.
              </EmptyState>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--line-on-white)" }}>
                {(comments.data ?? []).map((c) => (
                  <li key={c.id} className="px-5 py-4">
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      About {one<{ full_name: string }>(c.teachers)?.full_name ?? "a teacher"}
                      {one<{ name: string }>(c.subjects)?.name &&
                        ` · ${one<{ name: string }>(c.subjects)!.name}`}
                      {one<{ name: string }>(c.sections)?.name &&
                        ` · section ${one<{ name: string }>(c.sections)!.name}`}
                      {` · ${c.submitted_on}`}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                      {c.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {/* --- completion --------------------------------------------------- */}
        {show === "completion" && (
          <Card padded={false}>
            <CardHeader
              title="Who has finished"
              hint="Unfinished first. Names are safe here precisely because this table holds no answers: it says who still owes feedback, which is what holds back an admit card, and nothing about what anyone said."
            />

            {completionRows.length === 0 ? (
              <EmptyState icon="clipboard" title="No form has been generated yet">
                Generating forms above works out which teachers taught each
                student enough lessons to review, and creates one form per pair.
              </EmptyState>
            ) : (
              <DataTable
                caption="Feedback completion by student"
                head={
                  <>
                    <Th>Student</Th>
                    <Th>Class</Th>
                    <Th align="right">Done</Th>
                    <Th align="right">State</Th>
                  </>
                }
              >
                {[...completionRows]
                      .sort(
                        (a, b) =>
                          Number(a.completed_at !== null) - Number(b.completed_at !== null) ||
                          a.class_name.localeCompare(b.class_name) ||
                          a.roll_no - b.roll_no,
                      )
                  .map((r) => (
                    <Tr key={r.student_id}>
                      <Td>
                        <span className="block font-medium">{r.full_name}</span>
                        <span
                          className="numeric block text-xs"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {r.registration_no} · roll {r.roll_no}
                        </span>
                      </Td>
                      <Td>
                        <span style={{ color: "var(--text-secondary)" }}>
                          {r.class_name}
                          {r.section_name && ` — ${r.section_name}`}
                        </span>
                      </Td>
                      <Td numeric>
                        {r.targets_done} / {r.targets_total}
                      </Td>
                      <Td align="right">
                        {r.completed_at ? (
                          <Status tone="good">finished</Status>
                        ) : r.targets_total === 0 ? (
                          <Status tone="neutral">no forms</Status>
                        ) : r.targets_done > 0 ? (
                          <Status tone="warn" dot>
                            part done
                          </Status>
                        ) : (
                          <Status tone="bad" dot>
                            not started
                          </Status>
                        )}
                      </Td>
                    </Tr>
                  ))}
              </DataTable>
            )}
          </Card>
        )}
      </PageSections>
    </PortalShell>
  );
}
