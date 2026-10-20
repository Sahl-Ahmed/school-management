import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { Banner } from "@/components/form";
import {
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  PageHeader,
  PageSections,
  Status,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { StatCard } from "@/components/charts";
import { BookCard, BookGrid, type BookCardData } from "@/components/book-card";
import {
  BookCreator,
  ColourChanger,
  LinkChecker,
  PublishToggle,
  type ClassOption,
} from "./library-forms";

export const metadata: Metadata = { title: "Library" };
export const dynamic = "force-dynamic";

type CatalogueRow = BookCardData & {
  description: string | null;
  is_published: boolean;
  link_checked_at: string | null;
  class_id: string | null;
  class_to_id: string | null;
};

export default async function AuthorityLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view = "cards" } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  const [catalogue, classes] = await Promise.all([
    // The office asks for the unpublished ones too; the function only honours
    // that for an authority caller.
    supabase.rpc("library_catalogue", { p_include_unpublished: true }),
    supabase
      .from("classes")
      .select("id, name, level_order")
      .eq("is_active", true)
      .order("level_order"),
  ]);

  const books = (catalogue.data ?? []) as CatalogueRow[];
  const published = books.filter((b) => b.is_published);
  const broken = books.filter((b) => b.link_ok === false);
  const unchecked = books.filter((b) => b.link_checked_at === null);

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <PageSections>
        <PageHeader
          title="Library"
          meta="PDFs kept on Google Drive and linked here"
          description="Nothing is uploaded to this system, so a book is only ever as available as its Drive sharing allows."
        />

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            label="Published"
            value={published.length}
            detail={`of ${books.length} in the catalogue`}
            tone="good"
            icon="book"
          />
          <StatCard
            label="Drafts"
            value={books.length - published.length}
            detail="visible to the office only"
            tone="neutral"
            icon="clipboard"
          />
          <StatCard
            label="Broken links"
            value={broken.length}
            detail={broken.length > 0 ? "shown as unavailable to readers" : "none found"}
            tone={broken.length > 0 ? "bad" : "good"}
            icon="book"
          />
          <StatCard
            label="Never checked"
            value={unchecked.length}
            detail="link health unknown"
            tone={unchecked.length > 0 ? "warn" : "good"}
            icon="check"
          />
        </section>

        {broken.length > 0 && (
          <Banner tone="warning">
            {broken.length} book{broken.length === 1 ? "'s link is" : "s' links are"} broken:{" "}
            {broken.map((b) => b.title).slice(0, 3).join(", ")}
            {broken.length > 3 && ` and ${broken.length - 3} more`}. Readers see
            these as unavailable rather than opening a dead tab. The usual cause
            is a Drive file that was never shared as &quot;Anyone with the
            link&quot;.
          </Banner>
        )}

        <BookCreator classes={(classes.data ?? []) as ClassOption[]} />

        <Card>
          <LinkChecker bookCount={books.length} />
        </Card>

        <Card padded={false}>
          <CardHeader
            title="The catalogue"
            hint="Cards are what a reader sees; the list is for working through the catalogue quickly."
            actions={
              <nav aria-label="Choose a view" className="flex gap-1.5">
                {([["cards", "Cards"], ["list", "List"]] as const).map(([key, label]) => {
                  const active = view === key;
                  return (
                    <a
                      key={key}
                      href={`/authority/library?view=${key}`}
                      aria-current={active ? "page" : undefined}
                      className="px-3 py-1.5 text-sm font-medium"
                      style={{
                        borderRadius: "var(--radius-pill)",
                        background: active ? "var(--accent)" : "var(--surface-raised)",
                        color: active ? "#ffffff" : "var(--text-secondary)",
                        border: `1px solid ${active ? "var(--accent)" : "var(--line-strong)"}`,
                      }}
                    >
                      {label}
                    </a>
                  );
                })}
              </nav>
            }
          />

          {books.length === 0 ? (
            <EmptyState icon="book" title="Nothing in the library yet">
              Add the first book above. A book needs a title, a Drive link and a
              card colour; readers see it only once you publish it.
            </EmptyState>
          ) : view === "list" ? (
            <DataTable
              caption="The library catalogue"
              head={
                <>
                  <Th>Title</Th>
                  <Th>Subject</Th>
                  <Th>For</Th>
                  <Th>Link</Th>
                  <Th align="right">Actions</Th>
                </>
              }
            >
              {books.map((b) => (
                <Tr key={b.id}>
                  <Td className="max-w-xs">
                    <span className="block truncate font-medium" title={b.title}>
                      {b.title}
                    </span>
                    {b.author && (
                      <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                        {b.author}
                      </span>
                    )}
                  </Td>
                  <Td>{b.subject_label ?? "—"}</Td>
                  <Td>
                    <span style={{ color: "var(--text-secondary)" }}>{b.audience_label}</span>
                  </Td>
                  <Td>
                    {b.link_ok === false ? (
                      <Status tone="bad">broken</Status>
                    ) : b.link_ok === true ? (
                      <Status tone="good">working</Status>
                    ) : (
                      <Status tone="neutral">unchecked</Status>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {b.is_published ? (
                        <Status tone="good">published</Status>
                      ) : (
                        <Status tone="neutral">draft</Status>
                      )}
                      <PublishToggle bookId={b.id} isPublished={b.is_published} />
                      <ColourChanger bookId={b.id} current={b.card_color} />
                      <a
                        href={b.drive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="whitespace-nowrap text-xs font-medium underline"
                      >
                        Open
                      </a>
                    </div>
                  </Td>
                </Tr>
              ))}
            </DataTable>
          ) : (
            <CardBody>
              <BookGrid>
                {books.map((b) => (
                  <BookCard key={b.id} book={b} showDraftBadge />
                ))}
              </BookGrid>
            </CardBody>
          )}
        </Card>
      </PageSections>
    </PortalShell>
  );
}
