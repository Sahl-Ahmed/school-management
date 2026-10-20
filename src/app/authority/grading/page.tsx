import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { Banner } from "@/components/form";
import {
  Card,
  CardHeader,
  NavButton,
  PageHeader,
  PageSections,
} from "@/components/ui";
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

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          title="Grading policy"
          meta={`${scale ? scale.name : "No default scale is configured"} · used for every exam published from now on`}
          description="Bands, the subject pass percentage and the pass rule all live in the database, so a change of school policy needs no new code."
          actions={
            <NavButton href="/authority/exams" icon="exam">
              Exams
            </NavButton>
          }
        />

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
            <Card padded={false}>
              <CardHeader
                title="Pass and GPA rules"
                hint="These decide whether a student passes and what GPA is printed, and are recorded into every result published afterwards."
              />
              <RulesForm scale={scale as Scale} />
            </Card>

            <Card padded={false}>
              <CardHeader
                title="Grade bands"
                hint="A percentage maps to exactly one band. Overlapping bands are refused by the database, not merely discouraged here."
              />
              <BandList bands={(bands ?? []) as Band[]} />
            </Card>

            <Card padded={false}>
              <CardHeader
                title="Add or replace a band"
                hint="Saving a band whose grade already exists replaces it, so correcting a range does not need a delete first."
              />
              <BandForm scaleId={scale.id} />
            </Card>
          </>
        )}
      </PageSections>
    </PortalShell>
  );
}
