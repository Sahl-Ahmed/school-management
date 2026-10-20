import type { Route } from "next";
import { BookCard, BookGrid, type BookCardData } from "@/components/book-card";
import { Card, EmptyState, FilterChips } from "@/components/ui";

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
        /* Each chip carries its own count, so a reader can tell an empty
           subject from a full one before tapping it. */
        <FilterChips
          label="Filter by subject"
          options={[
            {
              href: basePath as Route,
              label: "All subjects",
              count: books.length,
              active: !activeSubject,
            },
            ...subjects.map((subject) => ({
              href: `${basePath}?subject=${encodeURIComponent(subject)}` as Route,
              label: subject,
              count: books.filter((b) => (b.subject_label ?? "") === subject).length,
              active: subject === activeSubject,
            })),
          ]}
        />
      )}

      {filtered.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon="book"
            title={activeSubject ? `Nothing under ${activeSubject}` : "No books to show"}
          >
            {emptyMessage}
          </EmptyState>
        </Card>
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
