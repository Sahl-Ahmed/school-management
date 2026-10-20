import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalShell } from "@/components/portal-shell";
import { AUTHORITY_NAV } from "../nav";
import { Banner } from "@/components/form";
import { Pill, StatCard } from "@/components/charts";
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

  const cardStyle = {
    borderRadius: "var(--radius-card)",
    background: "var(--surface-raised)",
    border: "1px solid var(--line-hairline)",
    boxShadow: "var(--shadow-card)",
  } as const;

  return (
    <PortalShell
      portalName="Authority portal"
      userName={profile?.full_name ?? "Authority"}
      nav={AUTHORITY_NAV}
    >
      <div className="space-y-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Library</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            PDFs kept on Google Drive and linked here. Nothing is uploaded to
            this system.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Published"
            value={published.length}
            detail={`of ${books.length} in the catalogue`}
            tone="good"
          />
          <StatCard
            label="Drafts"
            value={books.length - published.length}
            detail="visible to the office only"
            tone="neutral"
          />
          <StatCard
            label="Broken links"
            value={broken.length}
            detail={broken.length > 0 ? "shown as unavailable to readers" : "none found"}
            tone={broken.length > 0 ? "bad" : "good"}
          />
          <StatCard
            label="Never checked"
            value={unchecked.length}
            detail="link health unknown"
            tone={unchecked.length > 0 ? "warn" : "good"}
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

        <section className="p-4" style={cardStyle}>
          <LinkChecker bookCount={books.length} />
        </section>

        <section className="overflow-hidden" style={cardStyle}>
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            style={{ borderBottom: "1px solid var(--line-hairline)" }}
          >
            <h2 className="text-sm font-semibold">The catalogue</h2>
            <nav aria-label="Choose a view" className="flex gap-1">
              {[["cards", "Cards"], ["list", "List"]].map(([key, label]) => {
                const active = view === key;
                return (
                  <a
                    key={key}
                    href={`/authority/library?view=${key}`}
                    aria-current={active ? "page" : undefined}
                    className="px-2.5 py-1 text-xs font-medium"
                    style={{
                      borderRadius: "var(--radius-data)",
                      background: active ? "var(--accent)" : "transparent",
                      color: active ? "var(--text-on-accent)" : "var(--text-muted)",
                    }}
                  >
                    {label}
                  </a>
                );
              })}
            </nav>
          </div>

          {books.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Nothing in the library yet. Add the first book above.
            </p>
          ) : view === "list" ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">The library catalogue</caption>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line-strong)" }}>
                    <th scope="col" className="px-4 py-2 text-left font-semibold">Title</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Subject</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">For</th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">Link</th>
                    <th scope="col" className="px-4 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {books.map((b) => (
                    <tr key={b.id} style={{ borderBottom: "1px solid var(--line-hairline)" }}>
                      <td className="max-w-xs px-4 py-2">
                        <span className="block truncate font-medium" title={b.title}>
                          {b.title}
                        </span>
                        {b.author && (
                          <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                            {b.author}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{b.subject_label ?? "—"}</td>
                      <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                        {b.audience_label}
                      </td>
                      <td className="px-3 py-2">
                        {b.link_ok === false ? (
                          <Pill tone="bad">broken</Pill>
                        ) : b.link_ok === true ? (
                          <Pill tone="good">working</Pill>
                        ) : (
                          <Pill tone="neutral">unchecked</Pill>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center justify-end gap-3">
                          {b.is_published ? (
                            <Pill tone="good">published</Pill>
                          ) : (
                            <Pill tone="neutral">draft</Pill>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <BookGrid>
                {books.map((b) => (
                  <BookCard key={b.id} book={b} showDraftBadge />
                ))}
              </BookGrid>
            </div>
          )}
        </section>
      </div>
    </PortalShell>
  );
}
