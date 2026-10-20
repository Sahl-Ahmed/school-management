import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { STUDENT_NAV } from "../nav";
import { LibraryBrowser, type BrowserBook } from "@/components/library-browser";
import { one } from "@/lib/supabase/relations";

export const metadata: Metadata = { title: "Library" };
export const dynamic = "force-dynamic";

type CatalogueRow = BrowserBook & {
  class_to_id: string | null;
  is_published: boolean;
};

export default async function StudentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string; all?: string }>;
}) {
  const { subject, all } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  // The student's own class, so the default view is what is meant for them.
  const { data: enrollment } = await supabase
    .from("student_enrollments")
    .select("class_id, classes(name, level_order)")
    .eq("status", "active")
    .maybeSingle();

  // PostgREST types a to-one embed as an array, so `one` normalises both
  // shapes; see src/lib/supabase/relations.ts.
  const myLevel = one<{ name: string; level_order: number }>(
    enrollment?.classes,
  )?.level_order;

  const [catalogue, classes] = await Promise.all([
    supabase.rpc("library_catalogue", { p_include_unpublished: false }),
    supabase.from("classes").select("id, level_order"),
  ]);

  const levels = new Map(
    (classes.data ?? []).map((c) => [c.id as string, c.level_order as number]),
  );

  const published = (catalogue.data ?? []) as CatalogueRow[];

  /*
   * Which books are "for me".
   *
   * A book with no class is for everyone. A book with a range covers every
   * class between its ends inclusive, which is why the level numbers are
   * needed rather than just the ids — "Class 9–10" has to include a Class 9
   * student without listing them.
   */
  const forMe = published.filter((book) => {
    if (!book.class_id) return true;
    if (myLevel === undefined) return false;

    const from = levels.get(book.class_id);
    if (from === undefined) return false;

    const to = book.class_to_id ? levels.get(book.class_to_id) ?? from : from;
    return myLevel >= from && myLevel <= to;
  });

  const showAll = all === "1";
  const books = showAll ? published : forMe;
  const subjects = [...new Set(books.map((b) => b.subject_label ?? "").filter(Boolean))].sort();

  const otherCount = published.length - forMe.length;

  return (
    <PortalShell
      portalName="Student portal"
      userName={profile?.full_name ?? "Student"}
      nav={STUDENT_NAV}
    >
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Library</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {showAll
                ? `Everything in the library · ${published.length} book${published.length === 1 ? "" : "s"}`
                : `For your class · ${forMe.length} book${forMe.length === 1 ? "" : "s"}`}
            </p>
          </div>

          {/* Only offered when there is actually something else to see. */}
          {otherCount > 0 && (
            <a
              href={showAll ? "/student/library" : "/student/library?all=1"}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium"
              style={{ borderColor: "var(--line-strong)" }}
            >
              {showAll
                ? "Show only my class"
                : `Show all classes (${otherCount} more)`}
            </a>
          )}
        </header>

        <LibraryBrowser
          basePath="/student/library"
          books={books}
          subjects={subjects}
          activeSubject={subject}
          emptyMessage={
            published.length === 0
              ? "The library is empty for now. Books your teachers add will appear here."
              : subject
                ? `Nothing under ${subject} for your class.`
                : "Nothing is set for your class yet. Try showing all classes."
          }
        />

        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Books open in Google Drive in a new tab. If one says it is
          unavailable, the school already knows the link is broken and will
          replace it.
        </p>
      </div>
    </PortalShell>
  );
}
