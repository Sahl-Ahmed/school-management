import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "../nav";
import { Banner } from "@/components/form";
import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  NavButton,
  PageHeader,
  PageSections,
  Status,
} from "@/components/ui";
import { one } from "@/lib/supabase/relations";
import { prettyDate } from "@/lib/pdf/base";

export const metadata: Metadata = { title: "ID & admit card" };
export const dynamic = "force-dynamic";

/** Turns an eligibility block code into something a student can act on. */
const BLOCK_WORDS: Record<string, string> = {
  feedback_incomplete:
    "Your teacher feedback is not finished. Complete it and the card is released immediately.",
  monthly_fees_outstanding:
    "Monthly fees are outstanding up to this exam's month. Settle them at the office.",
  exam_fee_unpaid: "The exam fee for this exam is not paid.",
  no_rule_configured:
    "The school has not set the rules for this exam yet, so no card can be issued.",
  exam_not_found: "That exam no longer exists.",
};

type Eligibility = {
  eligible: boolean;
  blocks: string[];
  overridden?: boolean;
  outstanding_monthly?: number | string;
  outstanding_exam_fee?: number | string;
};

export default async function StudentDocumentsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const { data: student } = await supabase
    .from("students")
    .select("id, full_name, registration_no")
    .maybeSingle();

  const { data: year } = await supabase
    .from("academic_years").select("id, name").eq("is_current", true).maybeSingle();

  // Exams whose routine is published are the only ones a student can see at
  // all, so this list is already scoped by RLS.
  const { data: exams } = year
    ? await supabase
        .from("exams")
        .select("id, name, status, starts_on, results_published_at, terms(name)")
        .eq("academic_year_id", year.id)
        .order("starts_on", { ascending: false, nullsFirst: false })
    : { data: [] };

  const examRows = exams ?? [];

  // Eligibility per exam, from the single shared definition.
  const eligibility = new Map<string, Eligibility>();
  if (student) {
    await Promise.all(
      examRows.map(async (e) => {
        const { data } = await supabase.rpc("admit_card_eligibility", {
          p_student_id: student.id,
          p_exam_id: e.id,
        });
        if (data) eligibility.set(e.id, data as Eligibility);
      }),
    );
  }

  const { data: card } = await supabase
    .from("qr_tokens")
    .select("id, token, issued_at")
    .is("revoked_at", null)
    .maybeSingle();

  return (
    <PortalShell
      portalName="Student portal"
      userName={profile?.full_name ?? "Student"}
      nav={STUDENT_NAV}
    >
      <PageSections>
        <PageHeader
          title="ID &amp; admit card"
          meta={
            <>
              {student?.full_name}
              {student?.registration_no && ` · ${student.registration_no}`}
              {year?.name && ` · academic year ${year.name}`}
            </>
          }
        />

        {!student && (
          <Banner tone="error">
            Your account is not linked to a student record, so no documents can
            be shown. The school office can fix this.
          </Banner>
        )}

        {/* --- ID card ----------------------------------------------------- */}
        <Card padded={false}>
          <CardHeader
            title="Student ID card"
            hint="Printed at PVC card size. The office issues it; you can download and reprint it whenever you need to."
          />

          <CardBody className="space-y-4">
            {card ? (
              <>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Issued {prettyDate(card.issued_at.slice(0, 10))}. The QR on the
                  back opens a page showing the same details printed on the card,
                  plus the school&apos;s name and contact details — including the
                  guardian phone number on the card front, which anyone who scans
                  it can read. Nothing else about you is published there.
                </p>
                <div className="flex flex-wrap gap-2">
                  <ButtonLink
                    href={`/print/id-card/${student?.id}?side=both`}
                    download
                    tone="primary"
                    icon="card"
                  >
                    Download card (front &amp; back)
                  </ButtonLink>
                  <ButtonLink href={`/card/${card.token}`} icon="profile">
                    View my public card page
                  </ButtonLink>
                </div>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Print at 100%, not &quot;fit to page&quot; — the file is already
                  card-sized (54 × 85.6 mm). If you lose the card, tell the office:
                  they revoke the link so the old card stops resolving.
                </p>
              </>
            ) : (
              <Banner tone="info">
                No ID card has been issued to you yet. The school office issues
                these, and it appears here the moment one is.
              </Banner>
            )}
          </CardBody>
        </Card>

        {/* --- Admit cards -------------------------------------------------- */}
        <Card padded={false}>
          <CardHeader
            title="Admit cards"
            hint="Released once your feedback is complete and your fees are clear for the exam&rsquo;s month. The server checks both again at download, so a card you can see is a card you can use."
          />

          {examRows.length === 0 ? (
            <EmptyState icon="card" title="No exam schedule has been published yet">
              An exam appears here once the school publishes its routine. Your
              admit card is then released as soon as you meet the conditions
              above.
            </EmptyState>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line-on-white)" }}>
              {examRows.map((e) => {
                const elig = eligibility.get(e.id);
                const term = one<{ name: string }>(e.terms)?.name;

                return (
                  <li key={e.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{e.name}</p>
                        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                          {term && `${term} · `}
                          {e.starts_on ? prettyDate(e.starts_on) : "date not set"}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {elig?.overridden && <Status tone="warn">by exception</Status>}
                        {elig?.eligible ? (
                          <>
                            <Status tone="good">released</Status>
                            <ButtonLink
                              href={`/print/admit-card/${e.id}/${student?.id}`}
                              download
                              tone="primary"
                              icon="card"
                            >
                              Admit card
                            </ButtonLink>
                          </>
                        ) : (
                          <Status tone="bad" dot>
                            not released
                          </Status>
                        )}

                        <ButtonLink
                          href={`/print/exam-routine/${e.id}`}
                          download
                          icon="calendar"
                        >
                          Routine
                        </ButtonLink>
                      </div>
                    </div>

                    {/* Reasons, each as something the student can act on. */}
                    {elig && !elig.eligible && (
                      <ul className="mt-3 space-y-2">
                        {elig.blocks.map((block) => (
                          <li
                            key={block}
                            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-xs leading-relaxed"
                            style={{
                              borderRadius: "var(--radius-control)",
                              background: "var(--state-bad-soft)",
                              color: "var(--state-bad)",
                            }}
                          >
                            <span className="min-w-0 flex-1">
                              {BLOCK_WORDS[block] ?? block}
                            </span>
                            {block === "feedback_incomplete" && (
                              <NavButton href="/student/feedback" icon="feedback">
                                Give feedback
                              </NavButton>
                            )}
                            {block === "monthly_fees_outstanding" && (
                              <NavButton href="/student/fees" icon="money">
                                See my fees
                              </NavButton>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {e.results_published_at && (
                      <p className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                        <ButtonLink
                          href={`/print/result/${e.id}?student=${student?.id}`}
                          download
                          icon="chart"
                        >
                          Result sheet
                        </ButtonLink>
                        <span style={{ color: "var(--text-muted)" }}>
                          published {prettyDate(e.results_published_at.slice(0, 10))}
                        </span>
                      </p>
                    )}
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
