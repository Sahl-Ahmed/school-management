import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import type { Route } from "next";
import { Banner, SearchField } from "@/components/form";
import { RingMeter, StatCard } from "@/components/charts";
import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  FilterChips,
  NavButton,
  PageHeader,
  PageSections,
  Status,
  Td,
  Th,
  Tr,
} from "@/components/ui";
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
      <PageSections>
        <PageHeader
          title="Cards &amp; printables"
          meta={`Admit cards, ID cards, exam routines and result sheets${year ? ` · academic year ${year.name}` : ""}`}
        />

        {!selectedExam && (
          <Card padded={false}>
            <EmptyState
              icon="card"
              title="No exam exists yet"
              action={
                <NavButton href="/authority/exams" tone="primary" icon="exam">
                  Create an exam
                </NavButton>
              }
            >
              Admit cards and seat codes belong to an exam. ID cards do not
              — but they are issued from the student list on this page, which
              an exam supplies.
            </EmptyState>
          </Card>
        )}

        {selectedExam && (
          <>
            {/* Exam picker */}
            <FilterChips
              label="Choose an exam"
              options={examRows.map((e) => ({
                href: {
                  pathname: "/authority/cards" as Route,
                  query: query({ exam: e.id, student: undefined }),
                },
                label: `${e.name}${one<{ name: string }>(e.terms)?.name ? ` · ${one<{ name: string }>(e.terms)!.name}` : ""}`,
                active: e.id === selectedExam.id,
              }))}
            />

            <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <Card className="col-span-2">
                <RingMeter
                  value={eligible}
                  denominator={rows.length}
                  label="Cards released"
                  period={`${issued} of ${eligible} eligible have been issued`}
                />
              </Card>
              <StatCard
                label="Not released"
                value={rows.length - eligible}
                detail="feedback or fees outstanding"
                tone={rows.length - eligible > 0 ? "warn" : "good"}
                icon="card"
              />
              <StatCard
                label="Students sitting"
                value={rows.length}
                detail={classParam ? "in the selected class" : "across all classes"}
                tone="neutral"
                icon="students"
              />
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <AdmitRuleConfigurator
                  examId={selectedExam.id}
                  hasRule={Boolean(rule.data)}
                  rule={rule.data ?? null}
                />
              </Card>

              <Card className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold">Printables</h3>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    Admit cards print three to an A4 sheet. A student who has not
                    been released is left out of the stack, not printed with a
                    warning across the card.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <ButtonLink
                    href={`/print/admit-card/${selectedExam.id}/class${classParam ? `?class=${classParam}` : ""}`}
                    download
                    tone="primary"
                    icon="card"
                  >
                    Admit cards{classParam ? " (this class)" : " (all classes)"}
                  </ButtonLink>
                  <ButtonLink
                    href={`/print/exam-routine/${selectedExam.id}`}
                    download
                    icon="calendar"
                  >
                    Exam routine
                  </ButtonLink>
                  {selectedExam.results_published_at ? (
                    <ButtonLink
                      href={`/print/result/${selectedExam.id}`}
                      download
                      icon="chart"
                    >
                      Result sheets
                    </ButtonLink>
                  ) : (
                    <span
                      className="inline-flex items-center px-4 py-2.5 text-sm"
                      style={{
                        borderRadius: "var(--radius-control)",
                        border: "1px solid var(--line-strong)",
                        color: "var(--text-muted)",
                      }}
                    >
                      Result sheets — not published yet
                    </span>
                  )}
                </div>

                <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Print admit cards and result sheets at 100%. ID cards are
                  card-sized files, so &quot;fit to page&quot; would scale them
                  out of a holder.
                </p>
              </Card>
            </div>

            {/* --- the issue-and-chase table ------------------------------- */}
            <Card padded={false}>
              <CardHeader
                title="Admit cards"
                hint="Students who have not been released are listed first, with the reason, because that is the list the office works through."
                actions={
                  <SearchField
                    label="Search students by name or registration number"
                    placeholder="Name or registration number"
                    defaultValue={q}
                    hidden={{ exam: examParam, class: classParam }}
                  />
                }
              />

              <CardBody className="py-3">
                <FilterChips
                  label="Filter by class"
                  options={[
                    {
                      href: {
                        pathname: "/authority/cards" as Route,
                        query: query({ class: undefined }),
                      },
                      label: "All classes",
                      active: !classParam,
                    },
                    ...(classes.data ?? []).map((c) => ({
                      href: {
                        pathname: "/authority/cards" as Route,
                        query: query({ class: c.id }),
                      },
                      label: c.name,
                      active: c.id === classParam,
                    })),
                  ]}
                />
              </CardBody>

              {rows.length === 0 ? (
                <EmptyState
                  icon="students"
                  title={
                    q
                      ? "No student matches that search"
                      : "No class sitting this exam has enrolled students"
                  }
                >
                  {q
                    ? "Check the spelling, or search by registration number instead."
                    : "An exam covers the classes its subjects are configured for. Add subjects to the exam, or enroll students in those classes."}
                </EmptyState>
              ) : (
                <DataTable
                  caption="Admit card eligibility by student"
                  head={
                    <>
                      <Th>Student</Th>
                      <Th>Class</Th>
                      <Th>State</Th>
                      <Th>Seat code</Th>
                      <Th align="right">Actions</Th>
                    </>
                  }
                >
                  {[...rows]
                        .sort(
                          (a, b) =>
                            Number(a.eligible) - Number(b.eligible) ||
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
                        <Td>
                          {r.eligible ? (
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Status tone="good">released</Status>
                              {r.overridden && <Status tone="warn">by exception</Status>}
                            </span>
                          ) : (
                            <span className="flex flex-col items-start gap-1.5">
                              {r.blocks.map((b) => (
                                <Status key={b} tone="bad">
                                  {BLOCK_WORDS[b] ?? b}
                                </Status>
                              ))}
                              {Number(r.outstanding_monthly) > 0 && (
                                <span
                                  className="numeric text-xs"
                                  style={{ color: "var(--text-muted)" }}
                                >
                                  {taka(r.outstanding_monthly)} monthly
                                  {Number(r.outstanding_exam_fee) > 0 &&
                                    ` · ${taka(r.outstanding_exam_fee)} exam fee`}
                                </span>
                              )}
                            </span>
                          )}
                        </Td>
                        <Td numeric align="left">
                          {r.seat_token ?? (
                            <span style={{ color: "var(--text-muted)" }}>—</span>
                          )}
                          {r.issued_at && (
                            <span
                              className="block text-xs"
                              style={{ color: "var(--text-muted)" }}
                            >
                              issued {prettyDate(r.issued_at.slice(0, 10))}
                            </span>
                          )}
                        </Td>
                        <Td>
                          <div className="flex flex-wrap items-center justify-end gap-2">
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
                                pathname: "/authority/cards" as Route,
                                query: query({ student: r.student_id }),
                              }}
                              className="whitespace-nowrap text-xs font-medium underline"
                            >
                              ID card
                            </Link>
                          </div>
                        </Td>
                      </Tr>
                    ))}
                </DataTable>
              )}
            </Card>

            {/* --- ID card panel for the chosen student -------------------- */}
            {idStudent && (
              <Card>
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
              </Card>
            )}
          </>
        )}
      </PageSections>
    </PortalShell>
  );
}
