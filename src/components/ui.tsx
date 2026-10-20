import Link, { type LinkProps } from "next/link";
import type { Route } from "next";
import { Icon, type IconName } from "@/components/icon";

/**
 * Anywhere this design system takes a destination.
 *
 * `Route` alone covers a literal path, but half the links in this product carry
 * query parameters — a page number, a search term, the selected class — and
 * those read far better as an object than as a hand-built string. Typed routes
 * accept both, so the components do too.
 */
type Destination = LinkProps<Route>["href"];

/**
 * The shared layout primitives.
 *
 * Every screen in this product is one of a few shapes: a titled page, a card
 * with a heading, a table of rows, a figure with its context, or a message
 * saying there is nothing yet. Before this file each screen built those shapes
 * out of raw divs and inline styles, which is why the spacing drifted and no
 * two empty states read alike.
 *
 * These are Server Components with no state. Anything needing the browser —
 * a drawer, a form's pending state — lives in its own client component.
 */

/* ===========================================================================
   Surfaces
   =========================================================================== */

/**
 * A white card on the cream page.
 *
 * `padded` is off for cards that contain a table or a list that should run to
 * the card's edges; the heading and the body then supply their own padding.
 */
export function Card({
  children,
  padded = true,
  className = "",
  as: Tag = "section",
}: {
  children: React.ReactNode;
  padded?: boolean;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag
      className={`overflow-hidden ${padded ? "p-5" : ""} ${className}`}
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-on-white)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * A card's heading row, with optional actions on the right.
 *
 * `hint` is the sentence that explains what the card is for, and most cards
 * want one: these screens are used by an office clerk who did not read a manual.
 */
export function CardHeader({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header
      className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
      style={{ borderBottom: "1px solid var(--line-on-white)" }}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && (
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {hint}
          </p>
        )}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** The padded body of a card whose header handled its own padding. */
export function CardBody({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

/* ===========================================================================
   Page structure
   =========================================================================== */

/**
 * The title block at the top of a page.
 *
 * `meta` carries the thing every one of these screens needs and the old design
 * kept omitting: WHICH PERIOD the page is about. A dashboard that says "45
 * lessons awaiting attendance" without saying "in October 2026" is a figure
 * nobody can act on.
 */
export function PageHeader({
  title,
  meta,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  meta?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: { label: string; href: Destination };
}) {
  return (
    <header className="mb-6">
      {breadcrumb && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <Link
            href={breadcrumb.href}
            className="inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            <span aria-hidden="true" className="rotate-180">
              <Icon name="chevron" size={14} />
            </span>
            {breadcrumb.label}
          </Link>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {meta && (
            <p className="mt-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
              {meta}
            </p>
          )}
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {description}
            </p>
          )}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Consistent vertical rhythm between a page's sections. */
export function PageSections({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

/* ===========================================================================
   Actions
   =========================================================================== */

type ButtonTone = "primary" | "secondary" | "danger" | "quiet";

function buttonStyle(tone: ButtonTone): React.CSSProperties {
  switch (tone) {
    case "primary":
      return { background: "var(--accent)", color: "#ffffff", border: "1px solid var(--accent)" };
    case "danger":
      /*
       * OUTLINED, never solid. The brand is a dark red, so a filled danger
       * button would be nearly indistinguishable from the primary one — see
       * the states note in globals.css. Form carries the distinction that
       * colour cannot.
       */
      return {
        background: "var(--surface-raised)",
        color: "var(--state-bad)",
        border: "1px solid var(--state-bad)",
      };
    case "quiet":
      return { background: "transparent", color: "var(--text-secondary)", border: "1px solid transparent" };
    default:
      return {
        background: "var(--surface-raised)",
        color: "var(--text-primary)",
        border: "1px solid var(--line-strong)",
      };
  }
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-55";

/** A link that looks like a button. */
export function ButtonLink({
  href,
  tone = "secondary",
  icon,
  download,
  children,
  className = "",
}: {
  href: string;
  tone?: ButtonTone;
  icon?: IconName;
  download?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      download={download}
      className={`${BUTTON_BASE} ${className}`}
      style={buttonStyle(tone)}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </a>
  );
}

/** A non-submitting action rendered as a button-shaped link to a route. */
export function NavButton({
  href,
  tone = "secondary",
  icon,
  children,
}: {
  href: Destination;
  tone?: ButtonTone;
  icon?: IconName;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={BUTTON_BASE} style={buttonStyle(tone)}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </Link>
  );
}

export { BUTTON_BASE, buttonStyle };
export type { ButtonTone };

/* ===========================================================================
   Status
   =========================================================================== */

export type StatusTone = "good" | "warn" | "bad" | "neutral" | "accent" | "info";

const STATUS_COLOURS: Record<StatusTone, { fg: string; bg: string }> = {
  good: { fg: "var(--state-good)", bg: "var(--state-good-soft)" },
  warn: { fg: "var(--state-warn)", bg: "var(--state-warn-soft)" },
  bad: { fg: "var(--state-bad)", bg: "var(--state-bad-soft)" },
  neutral: { fg: "var(--state-neutral)", bg: "var(--state-neutral-soft)" },
  info: { fg: "var(--state-info)", bg: "var(--state-info-soft)" },
  accent: { fg: "var(--accent)", bg: "var(--accent-soft)" },
};

/**
 * A status label.
 *
 * Always carries words, never colour alone: these screens are read by people
 * with colour-blindness and printed on monochrome office printers, and in both
 * cases a bare coloured dot says nothing. The optional dot is an accent on the
 * text, not a substitute for it.
 */
export function Status({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: StatusTone;
  dot?: boolean;
  children: React.ReactNode;
}) {
  const colours = STATUS_COLOURS[tone];

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-xs font-medium"
      style={{
        borderRadius: "var(--radius-pill)",
        background: colours.bg,
        color: colours.fg,
      }}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: colours.fg }}
        />
      )}
      {children}
    </span>
  );
}

/* ===========================================================================
   Tables
   =========================================================================== */

/**
 * A table in a card.
 *
 * `caption` is required and screen-reader-only. Every table on these screens is
 * a table of people or money, and an unlabelled one is unusable with a screen
 * reader — making it a required prop is cheaper than remembering.
 */
export function DataTable({
  caption,
  head,
  foot,
  children,
}: {
  caption: string;
  head: React.ReactNode;
  /**
   * A totals row. In a real `<tfoot>`, so it is announced as a summary rather
   * than read as one more student, and so it stays put when the table scrolls.
   */
  foot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="scroll-soft overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr
            style={{
              borderBottom: "1px solid var(--line-strong)",
              background: "var(--surface-sunken)",
            }}
          >
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
        {foot && (
          <tfoot
            style={{
              borderTop: "1px solid var(--line-strong)",
              background: "var(--surface-sunken)",
            }}
          >
            {foot}
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** A column heading. `align` matches the cells beneath it. */
export function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2.5 text-${align} text-xs font-semibold uppercase tracking-[0.04em] sm:px-4 ${className}`}
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </th>
  );
}

/** A table row with the standard hairline beneath it. */
export function Tr({ children }: { children: React.ReactNode }) {
  return <tr style={{ borderBottom: "1px solid var(--line-on-white)" }}>{children}</tr>;
}

/** A cell. `numeric` right-aligns and uses tabular figures. */
export function Td({
  children,
  numeric = false,
  align,
  className = "",
  colSpan,
}: {
  /** Optional, so a spacer cell in a totals row needs no filler content. */
  children?: React.ReactNode;
  numeric?: boolean;
  align?: "left" | "right" | "center";
  className?: string;
  colSpan?: number;
}) {
  const resolved = align ?? (numeric ? "right" : "left");
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-3 text-${resolved} sm:px-4 ${numeric ? "numeric" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

/* ===========================================================================
   Empty states
   =========================================================================== */

/**
 * What a screen says when it has nothing to show.
 *
 * Every one of these says three things: what is missing, why, and what to do
 * next. "No data" is not an empty state — it is an apology. A teacher looking
 * at an empty mark sheet needs to know whether they are early, in the wrong
 * place, or waiting on the office.
 */
export function EmptyState({
  icon = "clipboard",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="mb-3 grid h-12 w-12 place-items-center rounded-full"
        style={{ background: "var(--surface-sunken)", color: "var(--text-muted)" }}
      >
        <Icon name={icon} size={22} />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {children && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {children}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ===========================================================================
   Loading
   =========================================================================== */

/**
 * A skeleton of the shape that is coming.
 *
 * These pages are tables and cards whose layout is known before the data
 * arrives, so showing that layout tells the reader what to expect and stops the
 * page jumping when it fills in. A centred spinner does neither.
 */
export function Skeleton({
  className = "",
  width,
  height = "1rem",
}: {
  className?: string;
  width?: string;
  height?: string;
}) {
  return <span className={`skeleton block ${className}`} style={{ width, height }} />;
}

export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              width={columnIndex === 0 ? "32%" : "18%"}
              height="0.875rem"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ===========================================================================
   Filter chips
   =========================================================================== */

/**
 * The row of links that filters a list.
 *
 * Links rather than client state, so a filtered view is shareable and the page
 * stays a Server Component. `count` is shown when known, because "Class 3" and
 * "Class 3 · 24" answer different questions.
 */
export function FilterChips({
  label,
  options,
}: {
  label: string;
  options: { href: Destination; label: string; count?: number; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="scroll-soft -mx-1 overflow-x-auto px-1">
      <ul className="flex gap-1.5 pb-1">
        {options.map((option) => (
          <li key={option.label}>
            <Link
              href={option.href}
              aria-current={option.active ? "page" : undefined}
              className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                borderRadius: "var(--radius-pill)",
                background: option.active ? "var(--accent)" : "var(--surface-raised)",
                color: option.active ? "#ffffff" : "var(--text-secondary)",
                border: `1px solid ${option.active ? "var(--accent)" : "var(--line-strong)"}`,
              }}
            >
              {option.label}
              {option.count !== undefined && (
                <span className="numeric opacity-70">{option.count}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ===========================================================================
   Definition list — the shape of a profile card
   =========================================================================== */

export function FieldList({
  items,
  columns = 2,
}: {
  items: { label: string; value: React.ReactNode; numeric?: boolean }[];
  columns?: 1 | 2 | 3;
}) {
  const grid = columns === 1 ? "" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";

  return (
    <dl className={`grid gap-x-6 gap-y-4 ${grid}`}>
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
            {item.label}
          </dt>
          <dd className={`mt-0.5 text-sm font-medium ${item.numeric ? "numeric" : ""}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
