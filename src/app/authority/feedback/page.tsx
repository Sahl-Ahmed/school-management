import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import type { Route } from "next";
import { Banner } from "@/components/form";
import {
  Card,
  CardHeader,
  EmptyState,
  NavButton,
  PageHeader,
  PageSections,
  Status,
} from "@/components/ui";
import { CampaignCreator, type TermOption } from "./campaign-forms";
import { one } from "@/lib/supabase/relations";

export const metadata: Metadata = { title: "Teacher feedback" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "neutral" | "good" | "warn"> = {
  draft: "neutral",
  open: "warn",
  closed: "good",
};

export default async function AuthorityFeedbackPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const { data: year } = await supabase
    .from("academic_years").select("id, name").eq("is_current", true).maybeSingle();

  const [terms, campaigns] = await Promise.all([
    year
      ? supabase
          .from("terms")
          .select("id, name, sequence, starts_on, ends_on")
          .eq("academic_year_id", year.id)
          .order("sequence")
      : Promise.resolve({ data: [] }),
    year
      ? supabase
          .from("feedback_campaigns")
          .select("id, name, status, opens_at, closes_at, blocks_admit_card, min_periods_taught, terms(name)")
          .eq("academic_year_id", year.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const termRows = (terms.data ?? []) as {
    id: string; name: string; starts_on: string; ends_on: string;
  }[];

  const termOptions: TermOption[] = termRows.map((t) => ({
    id: t.id,
    label: `${t.name} (${t.starts_on} to ${t.ends_on})`,
  }));

  // Form and completion counts per campaign, so the list says where each round
  // actually stands rather than only its label.
  const counts = new Map<string, { forms: number; finished: number }>();
  for (const c of campaigns.data ?? []) {
    const [{ count: forms }, { count: finished }] = await Promise.all([
      supabase
        .from("feedback_targets")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id),
      supabase
        .from("feedback_completions")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", c.id)
        .not("completed_at", "is", null),
    ]);
    counts.set(c.id, { forms: forms ?? 0, finished: finished ?? 0 });
  }

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          title="Teacher feedback"
          meta={`Academic year ${year?.name ?? "not set"}`}
          description="One round per term, with the questions, who is asked, and whether it holds back admit cards."
        />

        <Banner tone="info">
          Ratings and comments carry no student reference at all — not a hidden
          one, not an encrypted one. Nothing in the database can attribute an
          answer to a student, so a rating cannot be traced, and equally cannot
          be withdrawn once submitted. Teachers have no read access to these
          tables at any aggregation.
        </Banner>

        {!year && (
          <Banner tone="error">
            No academic year is marked as current, so a feedback round cannot be
            created.
          </Banner>
        )}

        {year && termRows.length === 0 && (
          <Banner tone="error">
            No terms exist for {year.name}. A feedback round belongs to a term.
          </Banner>
        )}

        {year && termRows.length > 0 && (
          <CampaignCreator academicYearId={year.id} terms={termOptions} />
        )}

        <Card padded={false}>
          <CardHeader
            title="Rounds this year"
            hint="Newest first. The counts are live: forms created, and students who have finished every one of theirs."
          />

          {(campaigns.data ?? []).length === 0 ? (
            <EmptyState icon="feedback" title="No feedback round has been created yet">
              A round is created above, against a term. Until one is open,
              students have nothing to fill in and admit cards are not held back
              by feedback.
            </EmptyState>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line-on-white)" }}>
              {(campaigns.data ?? []).map((c) => {
                const n = counts.get(c.id) ?? { forms: 0, finished: 0 };
                const term = one<{ name: string }>(c.terms)?.name;

                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/authority/feedback/${c.id}` as Route}
                        className="text-sm font-semibold underline-offset-2 hover:underline"
                      >
                        {c.name}
                      </Link>
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                        {term && `${term} · `}
                        {n.forms} form{n.forms === 1 ? "" : "s"} ·{" "}
                        {n.finished} student{n.finished === 1 ? "" : "s"} finished ·{" "}
                        minimum {c.min_periods_taught} lesson
                        {c.min_periods_taught === 1 ? "" : "s"}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {c.blocks_admit_card && (
                        <Status tone="info">holds back admit cards</Status>
                      )}
                      <Status tone={STATUS_TONE[c.status] ?? "neutral"} dot>
                        {c.status}
                      </Status>
                      <NavButton href={`/authority/feedback/${c.id}` as Route}>
                        Open
                      </NavButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </PageSections>
    </PortalShell>
  );
}
