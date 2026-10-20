import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { Banner } from "@/components/form";
import { Pill } from "@/components/charts";
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
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Teacher feedback</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Academic year {year?.name ?? "not set"}
          </p>
        </header>

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

        <section
          className="overflow-hidden"
          style={{
            borderRadius: "var(--radius-card)",
            background: "var(--surface-raised)",
            border: "1px solid var(--line-hairline)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
            <h2 className="text-sm font-semibold">Rounds this year</h2>
          </header>

          {(campaigns.data ?? []).length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No feedback rounds yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
              {(campaigns.data ?? []).map((c) => {
                const n = counts.get(c.id) ?? { forms: 0, finished: 0 };
                const term = one<{ name: string }>(c.terms)?.name;

                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/authority/feedback/${c.id}` as never}
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
                      {c.blocks_admit_card && <Pill tone="accent">Blocks admit cards</Pill>}
                      <Pill tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Pill>
                      <Link
                        href={`/authority/feedback/${c.id}` as never}
                        className="text-sm font-medium underline"
                      >
                        Open
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </PortalShell>
  );
}
