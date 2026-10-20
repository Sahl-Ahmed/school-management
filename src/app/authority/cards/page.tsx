import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { Banner } from "@/components/form";
import { Pill, RingMeter, StatCard } from "@/components/charts";
import {
  AdmitCardIssuer,
  AdmitRuleConfigurator,
  IdCardIssuer,
  OverrideForm,
} from "./card-forms";
import { one } from "@/lib/supabase/relations";
import { taka } from "@/lib/school/money";
import { prettyDate } from "@/lib/pdf/base";

export const metadata: Metadata = { title: "Cards & printables" };
export const dynamic = "force-dynamic";

const BLOCK_WORDS: Record<string, string> = {
  feedback_incomplete: "feedback not finished",
  monthly_fees_outstanding: "monthly fees outstanding",
  exam_fee_unpaid: "exam fee unpaid",
  no_rule_configured: "no rule configured",
  exam_not_found: "exam not found",
};

type AdmitRow = {
  student_id: string;
  full_name: string;
  registration_no: string;
  class_name: string;
  section_name: string | null;
  roll_no: number;
  eligible: boolean;
  blocks: string[];
  overridden: boolean;
  outstanding_monthly: string;
  outstanding_exam_fee: string;
  seat_token: string | null;
  issued_at: string | null;
};

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string; class?: string; student?: string; q?: string }>;
}) {
  const { exam: examParam, class: classParam, student: studentParam, q = "" } =
    await searchParams;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name, role").eq("id", user.id).maybeSingle();

  const isAdmin = profile?.role === "authority_admin";

  const { data: year } = await supabase
    .from("academic_years").select("id, name").eq("is_current", true).maybeSingle();

  const [exams, classes, templates] = await Promise.all([
    year
      ? supabase
          .from("exams")
          .select("id, name, status, starts_on, results_published_at, terms(name)")
          .eq("academic_year_id", year.id)
          .order("starts_on", { ascending: false, nullsFirst: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("classes").select("id, name, level_order").eq("is_active", true).order("level_order"),
    supabase
      .from("document_templates")
      .select("id, name, orientation, is_default")
      .eq("kind", "id_card")
      .eq("is_active", true)
      .order("is_default", { ascending: false }),
  ]);

  const examRows = exams.data ?? [];
  const selectedExam = examRows.find((e) => e.id === examParam) ?? examRows[0];

  const [overview, rule] = await Promise.all([
    selectedExam
      ? supabase.rpc("exam_admit_overview", {
          p_exam_id: selectedExam.id,
          p_class_id: classParam || null,
        })
      : Promise.resolve({ data: [] }),
    selectedExam
      ? supabase
          .from("admit_card_rules")
          .select("require_feedback, require_fees_cleared, fees_cleared_through_year, fees_cleared_through_month, require_exam_fee_paid, allowed_outstanding, allow_override")
          .eq("exam_id", selectedExam.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const rows = ((overview.data ?? []) as AdmitRow[]).filter((r) => {
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return (
      r.full_name.toLowerCase().includes(term) ||
      r.registration_no.toLowerCase().includes(term)
    );
  });

  const eligible = rows.filter((r) => r.eligible).length;
  const issued = rows.filter((r) => r.issued_at !== null).length;

  // The ID-card panel works on one student at a time, chosen from the table.
  const idStudent = studentParam
    ? rows.find((r) => r.student_id === studentParam) ?? null
    : null;

  const { data: idToken } = idStudent
    ? await supabase
        .from("qr_tokens")
        .select("id, token, issued_at")
        .eq("student_id", idStudent.student_id)
        .is("revoked_at", null)
        .maybeSingle()
    : { data: null };

  const cardStyle = {
    borderRadius: "var(--radius-card)",
    background: "var(--surface-raised)",
    border: "1px solid var(--line-hairline)",
    boxShadow: "var(--shadow-card)",
  } as const;

  const query = (extra: Record<string, string | undefined>) => {
    const base: Record<string, string> = {};
    if (examParam) base.exam = examParam;
    if (classParam) base.class = classParam;
    if (studentParam) base.student = studentParam;
    if (q) base.q = q;
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete base[k];
      else base[k] = v;
    }
    return base;
  };

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Cards &amp; printables</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Admit cards, ID cards, exam routines and result sheets
            {year && ` · academic year ${year.name}`}
          </p>
        </header>

        {!selectedExam && (
          <Banner tone="info">
            No exams exist yet. Admit cards and seat codes belong to an exam, so
            create one under{" "}
            <Link href={"/authority/exams" as never} className="underline">
              Exams
            </Link>{" "}
            first.
          </Banner>
        )}

        {selectedExam && (
          <>
            {/* Exam picker */}
            <nav aria-label="Choose an exam" className="overflow-x-auto">
              <ul className="flex gap-1 pb-1">
                {examRows.map((e) => {
                  const active = e.id === selectedExam.id;
                  return (
                    <li key={e.id}>
                      <Link
                        href={{ pathname: "/authority/cards", query: query({ exam: e.id, student: undefined }) }}
                        aria-current={active ? "page" : undefined}
                        className="block whitespace-nowrap px-3 py-2 text-sm"
                        style={{
                          borderRadius: "var(--radius-control)",
                          background: active ? "var(--accent)" : "var(--surface-raised)",
                          color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
                          border: `1px solid ${active ? "var(--accent)" : "var(--line-hairline)"}`,
                        }}
                      >
                        <span className="block font-medium">{e.name}</span>
                        <span className="block text-xs opacity-80">
                          {one<{ name: string }>(e.terms)?.name}
                          {e.starts_on && ` · ${prettyDate(e.starts_on)}`}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2 p-4" style={cardStyle}>
                <RingMeter
                  value={eligible}
                  denominator={rows.length}
                  label="Cards released"
                  period={`${issued} of ${eligible} eligible have been issued`}
                />
              </div>
              <StatCard
                label="Blocked"
                value={rows.length - eligible}
                detail="feedback or fees outstanding"
                tone={rows.length - eligible > 0 ? "warn" : "good"}
              />
              <StatCard
                label="Students sitting"
                value={rows.length}
                detail={classParam ? "in the selected class" : "across all classes"}
                tone="neutral"
              />
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="p-4" style={cardStyle}>
                <AdmitRuleConfigurator
                  examId={selectedExam.id}
                  hasRule={Boolean(rule.data)}
                  rule={rule.data ?? null}
                />
              </section>

              <section className="space-y-3 p-4" style={cardStyle}>
                <div>
                  <h3 className="text-sm font-semibold">Printables</h3>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    Admit cards print three to an A4 sheet. Blocked students are
                    left out of the stack, not printed with a warning.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/print/admit-card/${selectedExam.id}/class${classParam ? `?class=${classParam}` : ""}`}
                    download
                    className="rounded-lg px-3 py-2 text-sm font-medium text-white"
                    style={{ background: "var(--accent)" }}
                  >
                    Admit cards{classParam ? " (this class)" : " (all classes)"}
                  </a>
                  <a
                    href={`/print/exam-routine/${selectedExam.id}`}
                    download
                    className="rounded-lg border px-3 py-2 text-sm font-medium"
                    style={{ borderColor: "var(--line-strong)" }}
                  >
                    Exam routine
                  </a>
                  {selectedExam.results_published_at ? (
                    <a
                      href={`/print/result/${selectedExam.id}`}
                      download
                      className="rounded-lg border px-3 py-2 text-sm font-medium"
                      style={{ borderColor: "var(--line-strong)" }}
                    >
                      Result sheets
                    </a>
                  ) : (
                    <span
                      className="rounded-lg border px-3 py-2 text-sm"
                      style={{ borderColor: "var(--line-hairline)", color: "var(--text-muted)" }}
                    >
                      Result sheets — not published yet
                    </span>
                  )}
                </div>

                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Print admit cards and result sheets at 100%. ID cards are
                  card-sized files, so &quot;fit to page&quot; would scale them
                  out of a holder.
                </p>
              </section>
            </div>

            {/* --- the issue-and-chase table ------------------------------- */}
            <section className="overflow-hidden" style={cardStyle}>
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                style={{ borderBottom: "1px solid var(--line-hairline)" }}
              >
                <h2 className="text-sm font-semibold">
                  Admit cards
                  <span className="ml-2 font-normal" style={{ color: "var(--text-muted)" }}>
                    blocked first
                  </span>
                </h2>

                <form className="flex flex-wrap gap-2" role="search">
                  {examParam && <input type="hidden" name="exam" value={examParam} />}
                  {classParam && <input type="hidden" name="class" value={classParam} />}
                  <label htmlFor="q" className="sr-only">
                    Search by name or registration number
                  </label>
                  <input
                    id="q"
                    name="q"
                    defaultValue={q}
                    placeholder="Name or registration number"
                    className="rounded-lg border px-3 py-1.5 text-sm"
                    style={{ borderColor: "var(--line-hairline)", background: "var(--surface)" }}
                  />
                  <button
                    type="submit"
                    className="rounded-lg border px-3 py-1.5 text-sm font-medium"
                    style={{ borderColor: "var(--line-strong)" }}
                  >
                    Search
                  </button>
                </form>
              </div>

              <nav aria-label="Filter by class" className="overflow-x-auto px-4 py-2">
                <ul className="flex gap-1">
                  <li>
                    <Link
                      href={{ pathname: "/authority/cards", query: query({ class: undefined }) }}
                      aria-current={!classParam ? "page" : undefined}
                      className="block whitespace-nowrap px-2.5 py-1 text-xs font-medium"
                      style={{
                        borderRadius: "var(--radius-data)",
                        background: !classParam ? "var(--accent)" : "transparent",
                        color: !classParam ? "var(--text-on-accent)" : "var(--text-muted)",
                      }}
                    >
                      All classes
                    </Link>
                  </li>
                  {(classes.data ?? []).map((c) => {
                    const active = c.id === classParam;
                    return (
                      <li key={c.id}>
                        <Link
                          href={{ pathname: "/authority/cards", query: query({ class: c.id }) }}
                          aria-current={active ? "page" : undefined}
                          className="block whitespace-nowrap px-2.5 py-1 text-xs font-medium"
                          style={{
                            borderRadius: "var(--radius-data)",
                            background: active ? "var(--accent)" : "transparent",
                            color: active ? "var(--text-on-accent)" : "var(--text-muted)",
                          }}
                        >
                          {c.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              {rows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                  {q
                    ? "No students match that search."
                    : "No class sitting this exam has any enrolled students."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only">Admit card eligibility by student</caption>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                        <th scope="col" className="px-4 py-2 text-left font-semibold">Student</th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Class</th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">State</th>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Seat code</th>
                        <th scope="col" className="px-4 py-2 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...rows]
                        .sort(
                          (a, b) =>
                            Number(a.eligible) - Number(b.eligible) ||
                            a.class_name.localeCompare(b.class_name) ||
                            a.roll_no - b.roll_no,
                        )
                        .map((r) => (
                          <tr
                            key={r.student_id}
                            style={{ borderBottom: "1px solid var(--line-hairline)" }}
                          >
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
                            <td className="px-3 py-2">
                              {r.eligible ? (
                                <span className="flex flex-wrap items-center gap-1">
                                  <Pill tone="good">Released</Pill>
                                  {r.overridden && <Pill tone="warn">By exception</Pill>}
                                </span>
                              ) : (
                                <span className="space-y-1">
                                  {r.blocks.map((b) => (
                                    <span key={b} className="block">
                                      <Pill tone="bad">{BLOCK_WORDS[b] ?? b}</Pill>
                                    </span>
                                  ))}
                                  {Number(r.outstanding_monthly) > 0 && (
                                    <span
                                      className="numeric block text-xs"
                                      style={{ color: "var(--text-muted)" }}
                                    >
                                      {taka(r.outstanding_monthly)} monthly
                                      {Number(r.outstanding_exam_fee) > 0 &&
                                        ` · ${taka(r.outstanding_exam_fee)} exam fee`}
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="numeric px-3 py-2">
                              {r.seat_token ?? (
                                <span style={{ color: "var(--text-muted)" }}>—</span>
                              )}
                              {r.issued_at && (
                                <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                                  issued {prettyDate(r.issued_at.slice(0, 10))}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex flex-wrap items-start justify-end gap-2">
                                <AdmitCardIssuer
                                  examId={selectedExam.id}
                                  studentId={r.student_id}
                                  eligible={r.eligible}
                                  issuedAt={r.issued_at}
                                />

                                {r.eligible && (
                                  <a
                                    href={`/print/admit-card/${selectedExam.id}/${r.student_id}`}
                                    download
                                    className="whitespace-nowrap text-xs font-medium underline"
                                  >
                                    Card PDF
                                  </a>
                                )}

                                {!r.eligible && isAdmin && (
                                  <OverrideForm
                                    examId={selectedExam.id}
                                    studentId={r.student_id}
                                    studentName={r.full_name}
                                    allowed={Boolean(rule.data?.allow_override)}
                                  />
                                )}

                                <Link
                                  href={{
                                    pathname: "/authority/cards",
                                    query: query({ student: r.student_id }),
                                  }}
                                  className="whitespace-nowrap text-xs font-medium underline"
                                >
                                  ID card
                                </Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* --- ID card panel for the chosen student -------------------- */}
            {idStudent && (
              <section className="p-4" style={cardStyle}>
                <div className="mb-3">
                  <h2 className="text-sm font-semibold">
                    ID card — {idStudent.full_name}
                  </h2>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {idStudent.registration_no} · {idStudent.class_name}
                    {idStudent.section_name && ` — ${idStudent.section_name}`}
                  </p>
                </div>

                <Banner tone="warning">
                  The card front prints the guardian&apos;s phone number, as the
                  school chose, so whoever finds a lost card can call them. The
                  card&apos;s public QR page shows the same details the card
                  prints, so that number is <strong>readable by anyone who scans
                  the code</strong> — tell guardians before you hand the cards
                  out. Nothing beyond the printed fields is published: no parent
                  names, no fees, no marks, no attendance.
                </Banner>

                <div className="mt-3">
                  <IdCardIssuer
                    studentId={idStudent.student_id}
                    templates={(templates.data ?? []).map((t) => ({
                      id: t.id,
                      name: t.name,
                      orientation: t.orientation,
                    }))}
                    currentTokenId={idToken?.id ?? null}
                    currentToken={idToken?.token ?? null}
                  />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </PortalShell>
  );
}
