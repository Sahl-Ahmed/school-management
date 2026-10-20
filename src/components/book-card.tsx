import { readableOn } from "@/lib/school/contrast";
import { Pill } from "@/components/charts";

/**
 * A library book card, per the revised specification in
 * docs/design-system.md section 3.
 *
 * The earlier design — a thumbnail rendered from the PDF's first page — is
 * cancelled and is not built. A card is instead a coloured area carrying two
 * lines of text, with the full title below it:
 *
 *     ┌─────────────────────────────┐
 *     │         Biology             │  subject, large, the thing you look at
 *     │        Class 9–10           │  audience, smaller
 *     ├─────────────────────────────┤
 *     │ Essentials of Human Biology │  full title, outside the colour
 *     │ and Physiology, Volume II   │
 *     │                        Open │
 *     └─────────────────────────────┘
 *
 * Three details that are easy to get wrong and are the whole point:
 *
 *   * The text colour is COMPUTED from the background, never chosen. The
 *     office picks a colour; readableOn picks black or white and nudges the
 *     background if neither can reach WCAG AA on it.
 *   * A long title yields, the labels never do. The title wraps to three
 *     lines then truncates, with the full text kept as the accessible name
 *     and the tooltip, so nothing is lost. The subject and audience keep
 *     their size regardless.
 *   * Card height is uniform across a row, so one long title cannot make the
 *     grid ragged.
 */

export type BookCardData = {
  id: string;
  title: string;
  title_bn: string | null;
  author: string | null;
  subject_label: string | null;
  audience_label: string | null;
  card_color: string | null;
  drive_url: string;
  link_ok: boolean | null;
  is_published?: boolean;
};

export function BookCard({
  book,
  showDraftBadge = false,
}: {
  book: BookCardData;
  showDraftBadge?: boolean;
}) {
  const colours = readableOn(book.card_color);
  const broken = book.link_ok === false;

  return (
    <article
      className="flex h-full flex-col overflow-hidden"
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-hairline)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* The coloured area. Fixed height, so every card in a row matches. */}
      <div
        className="flex h-28 shrink-0 flex-col items-center justify-center px-4 text-center"
        style={{ background: colours.background }}
      >
        <p
          className="text-lg font-semibold leading-tight"
          style={{ color: colours.text }}
        >
          {book.subject_label?.trim() || "General"}
        </p>
        <p className="mt-1 text-xs font-medium" style={{ color: colours.textMuted }}>
          {book.audience_label?.trim() || "Everyone"}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {/*
          * The full title, outside the colour.
          *
          * `line-clamp-3` wraps to three lines then ellipsises; `title` keeps
          * the whole thing available on hover and to a screen reader, so a
          * truncated title is shortened on screen and nowhere else.
          */}
        <h3
          className="line-clamp-3 text-sm font-semibold leading-snug"
          title={book.title}
        >
          {book.title}
        </h3>

        {book.title_bn && (
          <p
            className="line-clamp-2 text-xs"
            style={{ color: "var(--text-muted)" }}
            title={book.title_bn}
          >
            {book.title_bn}
          </p>
        )}

        {book.author && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {book.author}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="flex flex-wrap gap-1.5">
            {showDraftBadge && book.is_published === false && (
              <Pill tone="neutral">Draft</Pill>
            )}
            {broken && <Pill tone="bad">Link broken</Pill>}
          </span>

          {/*
            * A labelled control, not a mystery click target on the whole card.
            * A known-broken link says so instead of opening a dead tab.
            */}
          {broken ? (
            <span
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--line-hairline)", color: "var(--text-muted)" }}
            >
              Unavailable
            </span>
          ) : (
            <a
              href={book.drive_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
              style={{ background: "var(--accent)" }}
            >
              Open
              <span className="sr-only"> {book.title} in Google Drive, opens in a new tab</span>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * A grid that keeps rows even.
 *
 * `auto-rows-fr` is what makes every card in a row the same height, so the
 * three-line title cap holds the grid together instead of merely limiting one
 * card.
 *
 * It applies from `sm` upwards ONLY. In a single column every row holds one
 * card, so equal row heights means every card is as tall as the tallest — on a
 * phone that left a book with a one-line title sitting in a tall box with its
 * Open button stranded at the bottom. There is no grid to keep even when there
 * is one card per row.
 */
export function BookGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 sm:auto-rows-fr sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}
