import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { TEACHER_NAV } from "../nav";
import { LibraryBrowser, type BrowserBook } from "@/components/library-browser";
import { Card, PageHeader, PageSections } from "@/components/ui";

export const metadata: Metadata = { title: "Library" };
export const dynamic = "force-dynamic";

type CatalogueRow = BrowserBook & { class_to_id: string | null };

export default async function TeacherLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>;
}) {
  const { subject } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const { data: catalogue } = await supabase.rpc("library_catalogue", {
    p_include_unpublished: false,
  });

  const books = (catalogue ?? []) as CatalogueRow[];
  const subjects = [...new Set(books.map((b) => b.subject_label ?? "").filter(Boolean))].sort();

  return (
    <PortalShell
      portalName="Teacher portal"
      userName={profile?.full_name ?? "Teacher"}
      nav={TEACHER_NAV}
    >
      <PageSections>
        <PageHeader
          title="Library"
          meta={`Every published book, across all classes · ${books.length} book${books.length === 1 ? "" : "s"}`}
        />

        <LibraryBrowser
          basePath="/teacher/library"
          books={books}
          subjects={subjects}
          activeSubject={subject}
          emptyMessage={
            books.length === 0
              ? "The library is empty for now. The school office adds books here."
              : `Nothing under ${subject}.`
          }
        />

        <Card>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Teachers see the whole library, not only their own classes&apos; books
            — material for a class above or below is often what you need when
            preparing. The school office adds and publishes books.
          </p>
        </Card>
      </PageSections>
    </PortalShell>
  );
}
