import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "../nav";
import { Banner } from "@/components/form";
import { RingMeter } from "@/components/charts";
import { FeedbackForm, type FeedbackTarget, type Question } from "./feedback-form";

export const metadata: Metadata = { title: "Teacher feedback" };
export const dynamic = "force-dynamic";

export default async function StudentFeedbackPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  // The open campaign. Campaigns are readable by every signed-in user, but a
  // student's own forms come from an RPC that filters to them.
  const { data: campaign } = await supabase
    .from("feedback_campaigns")
    .select("id, name, status, opens_at, closes_at, blocks_admit_card, terms(name)")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  /*
   * Only the forms and the questions are fetched. The completion row holds the
   * same counts, but deriving them from the forms already in hand keeps the
   * page's figures and its list from ever disagreeing.
   */
  const [forms, questions] = await Promise.all([
    campaign
      ? supabase.rpc("student_feedback_forms", { p_campaign_id: campaign.id })
      : Promise.resolve({ data: [] }),
    campaign
      ? supabase
          .from("feedback_questions")
          .select("id, prompt, prompt_bn, order_no, scale_min, scale_max")
          .eq("campaign_id", campaign.id)
          .order("order_no")
      : Promise.resolve({ data: [] }),
  ]);

  const targets = (forms.data ?? []) as FeedbackTarget[];
  const questionRows = (questions.data ?? []) as Question[];

  const done = targets.filter((t) => t.answered_at !== null).length;
  const pending = targets.filter((t) => t.answered_at === null);
  const finished = targets.length > 0 && done === targets.length;

  return (
    <PortalShell
      portalName="Student portal"
      userName={profile?.full_name ?? "Student"}
      nav={STUDENT_NAV}
    >
      <div className="space-y-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Teacher feedback</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {campaign
              ? `${campaign.name} · open now`
              : "No feedback round is open at the moment"}
          </p>
        </header>

        {/* Said before anything is answered, not after. */}
        <Banner tone="info">
          Your answers are anonymous. The school office sees the combined
          ratings and any comments, with no name attached; your teachers see
          neither. Only the fact that you finished is recorded against your name,
          because that is what releases your admit card.
        </Banner>

        {!campaign && (
          <Banner tone="info">
            Nothing to do. The school opens a feedback round before each term&apos;s
            exams, and it will appear here.
          </Banner>
        )}

        {campaign && targets.length === 0 && (
          <Banner tone="info">
            You have no forms in this round. That happens when no teacher has
            taught your class enough lessons yet for a fair review.
          </Banner>
        )}

        {campaign && questionRows.length === 0 && targets.length > 0 && (
          <Banner tone="error">
            This round has no questions set, so nothing can be submitted. The
            school office needs to add them.
          </Banner>
        )}

        {targets.length > 0 && (
          <section
            className="p-4"
            style={{
              borderRadius: "var(--radius-card)",
              background: "var(--surface-raised)",
              border: "1px solid var(--line-hairline)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <RingMeter
              value={done}
              denominator={targets.length}
              label="Forms completed"
              period={
                campaign?.closes_at
                  ? `closes ${new Date(campaign.closes_at).toLocaleDateString("en-GB")}`
                  : undefined
              }
            />

            {finished && (
              <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
                All done, thank you.{" "}
                {campaign?.blocks_admit_card && (
                  <>
                    Your{" "}
                    <Link href={"/student/documents" as never} className="underline">
                      admit card
                    </Link>{" "}
                    is no longer blocked by feedback.
                  </>
                )}
              </p>
            )}

            {!finished && campaign?.blocks_admit_card && (
              <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
                Your admit card stays blocked until every form is in.
              </p>
            )}
          </section>
        )}

        {/* Outstanding forms first — the point of the page is to finish them. */}
        {campaign && questionRows.length > 0 && (
          <div className="space-y-4">
            {[...pending, ...targets.filter((t) => t.answered_at !== null)].map((target) => (
              <FeedbackForm
                key={target.target_id}
                campaignId={campaign.id}
                target={target}
                questions={questionRows}
                commentAllowed
              />
            ))}
          </div>
        )}
      </div>
    </PortalShell>
  );
}
