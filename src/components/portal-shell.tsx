import type { Route } from "next";
import { signOut } from "@/app/login/actions";
import { PortalNav } from "@/components/portal-nav";

/**
 * Shared chrome for the three portals.
 *
 * One visual language across Authority, Teacher and Student, per
 * docs/design-system.md: the same header, the same navigation treatment, the
 * same surfaces. Role is distinguished by content and navigation only, never by
 * a different colour scheme per portal — a student should recognise the product
 * their teacher uses.
 *
 * The thin green rule along the top is the one piece of brand colour in the
 * chrome. It identifies the product without turning the header into a coloured
 * band, which is what makes administrative software look like a template.
 *
 * Navigation is passed in by each portal rather than derived from the role, so
 * adding a link is a deliberate act in one place and cannot accidentally
 * surface another portal's route.
 */
export type NavItem = {
  label: string;
  /** Omit for a section that is not built yet. */
  href?: Route;
  /** Short note shown on an unbuilt section, e.g. "phase 5". */
  note?: string;
};

export function PortalShell({
  portalName,
  userName,
  nav,
  children,
}: {
  portalName: string;
  userName: string;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      {/* Brand rule. Hidden in print, where a grey band wastes toner. */}
      <div
        aria-hidden="true"
        className="no-print h-1 w-full"
        style={{ background: "var(--accent)" }}
      />

      <header
        className="sticky top-0 z-10 no-print"
        style={{
          borderBottom: "1px solid var(--line-hairline)",
          background: "color-mix(in oklch, var(--surface-raised) 92%, transparent)",
          backdropFilter: "saturate(180%) blur(8px)",
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">School</p>
            <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
              {portalName}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span
              className="hidden max-w-[14rem] truncate text-xs sm:inline"
              style={{ color: "var(--text-muted)" }}
            >
              {userName}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor: "var(--line-strong)",
                  background: "var(--surface-raised)",
                }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {nav.length > 0 && <PortalNav items={nav} />}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
