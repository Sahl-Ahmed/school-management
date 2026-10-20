import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { one } from "@/lib/supabase/relations";
import { Banner, SearchField } from "@/components/form";
import {
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

export const metadata: Metadata = { title: "Students" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; class?: string }>;
}) {
  const {
    q = "",
    page = "1",
    class: classParam,
  } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const from = (pageNumber - 1) * PAGE_SIZE;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  // The class filter's own options. A school has a dozen classes, so the
  // filter is a row of chips rather than a dropdown: one tap, and the chosen
  // class is visible without opening anything.
  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, level_order")
    .eq("is_active", true)
    .order("level_order");

  const activeClass = (classes ?? []).find((c) => c.id === classParam);

  // Search by name or registration number. The trigram indexes added in
  // migration 0022 keep the substring match off a sequential scan.
  let query = supabase
    .from("students")
    .select(
      `id, registration_no, full_name, gender, photo_path, status,
       student_enrollments!inner(roll_no, status, class_id, classes(name), sections(name))`,
      { count: "exact" },
    )
    .eq("student_enrollments.status", "active")
    .order("full_name")
    .range(from, from + PAGE_SIZE - 1);

  if (activeClass) {
    query = query.eq("student_enrollments.class_id", activeClass.id);
  }

  const term = q.trim();
  if (term) {
    query = query.or(`full_name.ilike.%${term}%,registration_no.ilike.%${term}%`);
  }

  const { data: students, count, error } = await query;

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showing = students?.length ?? 0;

  const pageHref = (target: number) => ({
    pathname: "/authority/students" as Route,
    query: { q: term || undefined, class: activeClass?.id, page: target },
  });

  const filterHref = (classId?: string) => ({
    pathname: "/authority/students" as Route,
    query: { q: term || undefined, class: classId },
  });

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          title="Students"
          meta={
            <>
              {total} active {total === 1 ? "student" : "students"}
              {activeClass && ` in ${activeClass.name}`}
              {term && ` matching “${term}”`}
              {total > PAGE_SIZE && ` · showing ${from + 1}–${from + showing}`}
            </>
          }
          actions={
            <NavButton href="/authority/students/new" tone="primary" icon="students">
              Admit a student
            </NavButton>
          }
        />

        {/* Search and filter sit together, above the list they act on. */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SearchField
              label="Search students by name or registration number"
              placeholder="Name or registration number"
              defaultValue={term}
              hidden={{ class: activeClass?.id }}
            />
            {(term || activeClass) && (
              <Link
                href="/authority/students"
                className="text-sm underline"
                style={{ color: "var(--text-muted)" }}
              >
                Clear {term && activeClass ? "search and filter" : term ? "search" : "filter"}
              </Link>
            )}
          </div>

          {(classes ?? []).length > 0 && (
            <FilterChips
              label="Filter by class"
              options={[
                { href: filterHref(), label: "All classes", active: !activeClass },
                ...(classes ?? []).map((c) => ({
                  href: filterHref(c.id),
                  label: c.name,
                  active: c.id === activeClass?.id,
                })),
              ]}
            />
          )}
        </div>

        {error ? (
          <Banner tone="error">Could not load students: {error.message}</Banner>
        ) : (
          <Card padded={false}>
            <CardHeader
              title={activeClass ? `${activeClass.name} roster` : "All active students"}
              hint="A student is listed from their active enrollment, so a student who has left is not shown."
            />

            {showing === 0 ? (
              <EmptyState
                icon="students"
                title={
                  term
                    ? "No student matches that search"
                    : activeClass
                      ? `No student is enrolled in ${activeClass.name}`
                      : "No students admitted yet"
                }
                action={
                  term || activeClass ? undefined : (
                    <NavButton href="/authority/students/new" tone="primary" icon="students">
                      Admit the first student
                    </NavButton>
                  )
                }
              >
                {term
                  ? "Check the spelling, or search by registration number instead. The search matches any part of a name."
                  : activeClass
                    ? "This class exists and has sections, but no active enrollment points at it yet."
                    : "Admitting a student creates their sign-in and enrolls them in a class."}
              </EmptyState>
            ) : (
              <DataTable
                caption={
                  activeClass
                    ? `Active students in ${activeClass.name}`
                    : "All active students"
                }
                head={
                  <>
                    <Th>Name</Th>
                    <Th>Registration</Th>
                    <Th align="right">Roll</Th>
                    <Th>Class</Th>
                    <Th>Photo</Th>
                  </>
                }
              >
                {students!.map((s) => {
                  // PostgREST types embeds as arrays without generated types,
                  // and these are nested two deep, so the shape is named.
                  type Named = { name: string } | { name: string }[] | null;
                  const enrollment = one<{
                    roll_no: number;
                    classes: Named;
                    sections: Named;
                  }>(s.student_enrollments);
                  const cls = one<{ name: string }>(enrollment?.classes);
                  const sec = one<{ name: string }>(enrollment?.sections);

                  return (
                    <Tr key={s.id}>
                      <Td>
                        <span className="font-medium">{s.full_name}</span>
                      </Td>
                      <Td numeric align="left">
                        {s.registration_no}
                      </Td>
                      <Td numeric>{enrollment?.roll_no ?? "—"}</Td>
                      <Td>
                        <span style={{ color: "var(--text-secondary)" }}>
                          {cls?.name ?? "—"}
                          {sec?.name ? ` — ${sec.name}` : ""}
                        </span>
                      </Td>
                      <Td>
                        {s.photo_path ? (
                          <Status tone="good">on file</Status>
                        ) : (
                          /*
                           * Worth saying plainly rather than leaving blank: a
                           * student with no photo gets an ID card with an empty
                           * box, and this list is where the office notices.
                           */
                          <Status tone="warn">not uploaded</Status>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </DataTable>
            )}

            {lastPage > 1 && (
              <CardBody className="flex flex-wrap items-center justify-between gap-3 pt-0">
                <p className="numeric text-xs" style={{ color: "var(--text-muted)" }}>
                  Page {pageNumber} of {lastPage}
                </p>
                <nav aria-label="Pagination" className="flex items-center gap-2">
                  {pageNumber > 1 && (
                    <NavButton href={pageHref(pageNumber - 1)}>Previous</NavButton>
                  )}
                  {pageNumber < lastPage && (
                    <NavButton href={pageHref(pageNumber + 1)}>Next</NavButton>
                  )}
                </nav>
              </CardBody>
            )}
          </Card>
        )}
      </PageSections>
    </PortalShell>
  );
}
