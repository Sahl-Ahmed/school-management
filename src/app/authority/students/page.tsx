import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { one } from "@/lib/supabase/relations";

export const metadata: Metadata = { title: "Students" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page = "1" } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
  const from = (pageNumber - 1) * PAGE_SIZE;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  // Search by name or registration number. The trigram indexes added in
  // migration 0022 keep the substring match off a sequential scan.
  let query = supabase
    .from("students")
    .select(
      `id, registration_no, full_name, gender, photo_path, status,
       student_enrollments!inner(roll_no, status, classes(name), sections(name))`,
      { count: "exact" },
    )
    .eq("student_enrollments.status", "active")
    .order("full_name")
    .range(from, from + PAGE_SIZE - 1);

  const term = q.trim();
  if (term) {
    query = query.or(
      `full_name.ilike.%${term}%,registration_no.ilike.%${term}%`,
    );
  }

  const { data: students, count, error } = await query;

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Students</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {total} active {total === 1 ? "student" : "students"}
              {term && ` matching “${term}”`}
            </p>
          </div>
          <Link
            href="/authority/students/new"
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-white"
            style={{ background: "var(--color-brand-600)" }}
          >
            Admit a student
          </Link>
        </header>

        <form className="flex gap-2" role="search">
          <label htmlFor="q" className="sr-only">
            Search by name or registration number
          </label>
          <input
            id="q"
            name="q"
            defaultValue={term}
            placeholder="Search by name or registration number"
            className="w-full max-w-sm rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: "var(--border-subtle)",
              background: "var(--surface-raised)",
              color: "var(--text-primary)",
            }}
          />
          <button
            type="submit"
            className="rounded-lg border px-4 py-2 text-sm font-medium"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            Search
          </button>
          {term && (
            <Link
              href="/authority/students"
              className="self-center text-sm underline"
              style={{ color: "var(--text-muted)" }}
            >
              Clear
            </Link>
          )}
        </form>

        {error ? (
          <p
            role="alert"
            className="rounded-lg px-3 py-2 text-sm"
            style={{ background: "oklch(0.96 0.03 25)", color: "oklch(0.42 0.15 25)" }}
          >
            Could not load students: {error.message}
          </p>
        ) : (students?.length ?? 0) === 0 ? (
          <div
            className="rounded-xl border p-8 text-center"
            style={{ borderColor: "var(--border-subtle)", background: "var(--surface-raised)" }}
          >
            <p className="text-sm font-medium">
              {term ? "No students match that search." : "No students admitted yet."}
            </p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {term
                ? "Check the spelling, or search by registration number instead."
                : "Admitting a student creates their account and enrolls them in a class."}
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {students!.map((s) => {
              // PostgREST types embeds as arrays without generated types, and
              // these are nested two deep, so the shape is named explicitly.
              type Named = { name: string } | { name: string }[] | null;
              const enrollment = one<{
                roll_no: number;
                classes: Named;
                sections: Named;
              }>(s.student_enrollments);
              const cls = one<{ name: string }>(enrollment?.classes);
              const sec = one<{ name: string }>(enrollment?.sections);

              return (
                <li
                  key={s.id}
                  className="rounded-xl border p-4"
                  style={{
                    borderColor: "var(--border-subtle)",
                    background: "var(--surface-raised)",
                  }}
                >
                  <p className="truncate font-medium">{s.full_name}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div>
                      <dt style={{ color: "var(--text-muted)" }}>Registration</dt>
                      <dd className="numeric">{s.registration_no}</dd>
                    </div>
                    <div>
                      <dt style={{ color: "var(--text-muted)" }}>Roll</dt>
                      <dd className="numeric">{enrollment?.roll_no ?? "—"}</dd>
                    </div>
                    <div>
                      <dt style={{ color: "var(--text-muted)" }}>Class</dt>
                      <dd>
                        {cls?.name ?? "—"}
                        {sec?.name ? ` — ${sec.name}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt style={{ color: "var(--text-muted)" }}>Photo</dt>
                      <dd>{s.photo_path ? "On file" : "Not uploaded"}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}

        {lastPage > 1 && (
          <nav aria-label="Pagination" className="flex items-center gap-3 text-sm">
            {pageNumber > 1 && (
              <Link
                href={{ pathname: "/authority/students", query: { q: term || undefined, page: pageNumber - 1 } }}
                className="underline"
              >
                Previous
              </Link>
            )}
            <span style={{ color: "var(--text-muted)" }}>
              Page {pageNumber} of {lastPage}
            </span>
            {pageNumber < lastPage && (
              <Link
                href={{ pathname: "/authority/students", query: { q: term || undefined, page: pageNumber + 1 } }}
                className="underline"
              >
                Next
              </Link>
            )}
          </nav>
        )}
      </div>
    </PortalShell>
  );
}
