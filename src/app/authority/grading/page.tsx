import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { Banner } from "@/components/form";
import { BandForm, BandList, RulesForm, type Band, type Scale } from "./grading-forms";

export const metadata: Metadata = { title: "Grading policy" };
export const dynamic = "force-dynamic";

/**
 * The grading policy screen.
 *
 * Everything the result calculation depends on is here, in the database: the
 * bands, the subject pass percentage and the pass rule. Nothing in the
 * application assumes a scale, so a school with a different policy changes it
 * here rather than asking for new code.
 */
export default async function GradingPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const { data: scale } = await supabase
    .from("grading_scales")
    .select("id, name, pass_rule, subject_pass_pct, fail_zeroes_gpa, no_gpa_below_level")
    .eq("is_default", true)
    .maybeSingle();

  const { data: bands } = scale
    ? await supabase
        .from("grade_bands")
        .select("id, grade, min_pct, max_pct, grade_point, is_pass")
        .eq("scale_id", scale.id)
    : { data: [] };

  const { count: publishedExams } = await supabase
    .from("exams")
    .select("id", { count: "exact", head: true })
    .not("results_published_at", "is", null);

  const card = {
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
          <h1 className="text-xl font-semibold tracking-tight">Grading policy</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {scale ? scale.name : "No default scale is configured"} · used for every
            exam published from now on
          </p>
        </header>

        {!scale && (
          <Banner tone="error">
            No grading scale is marked as the default, so results cannot be
            graded or published. A scale and its bands must exist first.
          </Banner>
        )}

        {(publishedExams ?? 0) > 0 && (
          <Banner tone="info">
            {publishedExams} exam{publishedExams === 1 ? " has" : "s have"} already
            been published. Changing the policy here does not alter{" "}
            {publishedExams === 1 ? "that sheet" : "those sheets"} — each
            published result keeps a frozen copy of the figures it was published
            with.
          </Banner>
        )}

        {scale && (
          <>
            <section style={card}>
              <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                <h2 className="text-sm font-semibold">Pass and GPA rules</h2>
              </header>
              <RulesForm scale={scale as Scale} />
            </section>

            <section style={card}>
              <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                <h2 className="text-sm font-semibold">Grade bands</h2>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  A percentage maps to exactly one band. Overlaps are refused by
                  the database.
                </p>
              </header>
              <BandList bands={(bands ?? []) as Band[]} />
            </section>

            <section style={card}>
              <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                <h2 className="text-sm font-semibold">Add or replace a band</h2>
              </header>
              <BandForm scaleId={scale.id} />
            </section>
          </>
        )}

        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          <Link href={"/authority/exams" as never} className="underline">
            Back to exams
          </Link>
        </p>
      </div>
    </PortalShell>
  );
}
