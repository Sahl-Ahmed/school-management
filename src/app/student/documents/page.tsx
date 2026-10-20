import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "../nav";
import { Banner } from "@/components/form";
import { Pill } from "@/components/charts";
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

  const cardStyle = {
    borderRadius: "var(--radius-card)",
    background: "var(--surface-raised)",
    border: "1px solid var(--line-hairline)",
    boxShadow: "var(--shadow-card)",
  } as const;

  return (
    <PortalShell
      portalName="Student portal"
      userName={profile?.full_name ?? "Student"}
      nav={STUDENT_NAV}
    >
      <div className="space-y-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">ID &amp; admit card</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {student?.full_name}
            {student?.registration_no && ` · ${student.registration_no}`}
          </p>
        </header>

        {!student && (
          <Banner tone="error">
            Your account is not linked to a student record, so no documents can
            be shown. The school office can fix this.
          </Banner>
        )}

        {/* --- ID card ----------------------------------------------------- */}
        <section style={cardStyle}>
          <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
            <h2 className="text-sm font-semibold">Student ID card</h2>
          </header>

          <div className="space-y-3 p-4">
            {card ? (
              <>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Issued {prettyDate(card.issued_at.slice(0, 10))}. The QR on the
                  back opens a page showing the same details printed on the card,
                  plus the school&apos;s name and contact details — including the
                  guardian phone number on the card front, which anyone who scans
                  it can read. Nothing else about you is published there.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/print/id-card/${student?.id}?side=both`}
                    download
                    className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                    style={{ background: "var(--accent)" }}
                  >
                    Download card (front &amp; back)
                  </a>
                  <a
                    href={`/card/${card.token}`}
                    className="rounded-lg border px-4 py-2 text-sm font-medium"
                    style={{ borderColor: "var(--line-strong)" }}
                  >
                    View my public card page
                  </a>
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
                these.
              </Banner>
            )}
          </div>
        </section>

        {/* --- Admit cards -------------------------------------------------- */}
        <section style={cardStyle}>
          <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-hairline)" }}>
            <h2 className="text-sm font-semibold">Admit cards</h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              Released once your feedback is complete and your fees are clear for
              the exam&apos;s month.
            </p>
          </header>

          {examRows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No exam schedule has been published yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
              {examRows.map((e) => {
                const elig = eligibility.get(e.id);
                const term = one<{ name: string }>(e.terms)?.name;

                return (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{e.name}</p>
                        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                          {term && `${term} · `}
                          {e.starts_on ? prettyDate(e.starts_on) : "date not set"}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {elig?.overridden && <Pill tone="warn">By exception</Pill>}
                        {elig?.eligible ? (
                          <>
                            <Pill tone="good">Released</Pill>
                            <a
                              href={`/print/admit-card/${e.id}/${student?.id}`}
                              download
                              className="rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                              style={{ background: "var(--accent)" }}
                            >
                              Download
                            </a>
                          </>
                        ) : (
                          <Pill tone="bad">Blocked</Pill>
                        )}

                        <a
                          href={`/print/exam-routine/${e.id}`}
                          download
                          className="text-sm font-medium underline"
                        >
                          Exam routine
                        </a>
                      </div>
                    </div>

                    {/* Reasons, each as something the student can act on. */}
                    {elig && !elig.eligible && (
                      <ul className="mt-2 space-y-1">
                        {elig.blocks.map((block) => (
                          <li
                            key={block}
                            className="rounded-lg px-3 py-2 text-xs"
                            style={{
                              background: "var(--state-bad-soft)",
                              color: "var(--state-bad)",
                            }}
                          >
                            {BLOCK_WORDS[block] ?? block}
                            {block === "feedback_incomplete" && (
                              <>
                                {" "}
                                <Link href={"/student/feedback" as never} className="underline">
                                  Go to feedback
                                </Link>
                              </>
                            )}
                            {block === "monthly_fees_outstanding" && (
                              <>
                                {" "}
                                <Link href={"/student/fees" as never} className="underline">
                                  See my fees
                                </Link>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {e.results_published_at && (
                      <p className="mt-2 text-xs">
                        <a
                          href={`/print/result/${e.id}?student=${student?.id}`}
                          download
                          className="font-medium underline"
                        >
                          Download result sheet
                        </a>
                        <span style={{ color: "var(--text-muted)" }}>
                          {" "}
                          · published {prettyDate(e.results_published_at.slice(0, 10))}
                        </span>
                      </p>
                    )}
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
