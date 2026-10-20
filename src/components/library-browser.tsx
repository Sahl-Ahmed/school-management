import Link from "next/link";
import { BookCard, BookGrid, type BookCardData } from "@/components/book-card";
import { Banner } from "@/components/form";

/**
 * The reader's view of the library, shared by the student and teacher portals.
 *
 * One component rather than two pages with the same grid in them: the two
 * audiences read the same catalogue, and a filter that behaved differently on
 * one of them would be a bug nobody noticed for months.
 *
 * Filtering is by link, not by client state, so a filtered view is shareable
 * and the page stays a server component.
 */

export type BrowserBook = BookCardData & { class_id: string | null };

export function LibraryBrowser({
  basePath,
  books,
  subjects,
  activeSubject,
  emptyMessage,
}: {
  basePath: string;
  books: BrowserBook[];
  subjects: string[];
  activeSubject?: string;
  emptyMessage: string;
}) {
  const filtered = activeSubject
    ? books.filter((b) => (b.subject_label ?? "") === activeSubject)
    : books;

  return (
    <div className="space-y-4">
      {subjects.length > 1 && (
        <nav aria-label="Filter by subject" className="overflow-x-auto">
          <ul className="flex gap-1 pb-1">
            <li>
              <Link
                href={basePath as never}
                aria-current={!activeSubject ? "page" : undefined}
                className="block whitespace-nowrap px-3 py-1.5 text-sm font-medium"
                style={{
                  borderRadius: "var(--radius-control)",
                  background: !activeSubject ? "var(--accent)" : "var(--surface-raised)",
                  color: !activeSubject ? "var(--text-on-accent)" : "var(--text-secondary)",
                  border: `1px solid ${!activeSubject ? "var(--accent)" : "var(--line-hairline)"}`,
                }}
              >
                All subjects
                <span className="ml-1.5 opacity-70">{books.length}</span>
              </Link>
            </li>
            {subjects.map((subject) => {
              const active = subject === activeSubject;
              const count = books.filter((b) => (b.subject_label ?? "") === subject).length;
              return (
                <li key={subject}>
                  <Link
                    href={`${basePath}?subject=${encodeURIComponent(subject)}` as never}
                    aria-current={active ? "page" : undefined}
                    className="block whitespace-nowrap px-3 py-1.5 text-sm font-medium"
                    style={{
                      borderRadius: "var(--radius-control)",
                      background: active ? "var(--accent)" : "var(--surface-raised)",
                      color: active ? "var(--text-on-accent)" : "var(--text-secondary)",
                      border: `1px solid ${active ? "var(--accent)" : "var(--line-hairline)"}`,
                    }}
                  >
                    {subject}
                    <span className="ml-1.5 opacity-70">{count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {filtered.length === 0 ? (
        <Banner tone="info">{emptyMessage}</Banner>
      ) : (
        <BookGrid>
          {filtered.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </BookGrid>
      )}
    </div>
  );
}
