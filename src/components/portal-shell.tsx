import Link from "next/link";
import type { Route } from "next";
import { signOut } from "@/app/login/actions";

/**
 * Shared chrome for the three portals: a header with the school name, the
 * signed-in user, a sign-out action, and a navigation rail.
 *
 * Navigation is passed in by each portal rather than derived from the role, so
 * that adding a link is a deliberate act in one place and cannot accidentally
 * surface another portal's route.
 *
 * A nav item with no `href` is a section that has not been built yet. It
 * renders as a disabled label rather than a link, because a link that 404s
 * reads as a broken product, while a greyed-out item reads as a roadmap.
 */
export type NavItem = {
  label: string;
  /** Omit for a section that is not built yet. */
  href?: Route;
  /** Short note shown next to an unbuilt section, e.g. "phase 3". */
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
      <header
        className="sticky top-0 z-10 border-b backdrop-blur"
        style={{
          borderColor: "var(--border-subtle)",
          background: "color-mix(in oklch, var(--surface-raised) 85%, transparent)",
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">School</p>
            <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
              {portalName}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span
              className="hidden text-xs sm:inline"
              style={{ color: "var(--text-muted)" }}
            >
              {userName}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border px-3 py-1.5 text-xs font-medium"
                style={{ borderColor: "var(--border-subtle)" }}
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {nav.length > 0 && (
          <nav
            aria-label={`${portalName} sections`}
            className="mx-auto max-w-6xl overflow-x-auto px-4"
          >
            <ul className="flex gap-1 pb-2">
              {nav.map((item) => (
                <li key={item.label}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span
                      aria-disabled="true"
                      title={item.note ? `Not built yet — ${item.note}` : "Not built yet"}
                      className="block cursor-not-allowed whitespace-nowrap rounded-lg px-3 py-1.5 text-sm opacity-50"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {item.label}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
