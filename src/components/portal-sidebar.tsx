"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icon";
import type { NavGroup } from "@/components/nav";

/**
 * The left sidebar, and its mobile incarnation as a drawer.
 *
 * Three pieces, because the trigger button has to live in the top bar while the
 * drawer covers the page:
 *
 *   SidebarNav     the navigation itself, shared by both — so the desktop
 *                  column and the mobile drawer cannot drift out of step
 *   DesktopSidebar the fixed column, from `lg` upwards
 *   MobileDrawer   the Menu button and the sheet it opens, below `lg`
 *
 * They are client components for three reasons, all of which need the browser:
 * marking the active page from the pathname, opening and closing the drawer,
 * and closing it again when a link inside it is followed. The shell around them
 * stays a Server Component.
 *
 * The active page is marked with a FILLED white panel on the maroon, not an
 * underline. In a vertical list an underline is nearly invisible, and "which
 * page am I on" is the question a sidebar exists to answer — so it gets the
 * loudest signal available, plus `aria-current` for anyone not looking at it.
 */

function activeHrefFor(groups: NavGroup[], pathname: string) {
  /** Longest matching href wins, so /teacher/marks does not light up /teacher. */
  return groups
    .flatMap((group) => group.items)
    .map((item) => item.href)
    .filter((href): href is NonNullable<typeof href> => Boolean(href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => String(b).length - String(a).length)[0];
}

function SidebarNav({
  groups,
  portalName,
}: {
  groups: NavGroup[];
  portalName: string;
}) {
  const pathname = usePathname();
  const active = activeHrefFor(groups, pathname);

  return (
    <nav
      aria-label={`${portalName} sections`}
      className="scroll-soft flex-1 overflow-y-auto px-3 pb-4"
    >
      {groups.map((group, groupIndex) => (
        <div key={group.title || `group-${groupIndex}`} className={groupIndex > 0 ? "mt-5" : ""}>
          {group.title && (
            <h2
              className="px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]"
              style={{ color: "rgb(255 255 255 / 0.52)" }}
            >
              {group.title}
            </h2>
          )}

          <ul className="space-y-0.5">
            {group.items.map((item) => {
              if (!item.href) {
                /*
                 * A section whose work has not landed. A disabled label rather
                 * than a link: a link that 404s reads as a broken product,
                 * while a dimmed item with a note reads as a roadmap.
                 */
                return (
                  <li key={item.label}>
                    <span
                      aria-disabled="true"
                      title={item.note ? `Not built yet — ${item.note}` : "Not built yet"}
                      className="flex cursor-not-allowed items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-sm"
                      style={{ color: "rgb(255 255 255 / 0.4)" }}
                    >
                      <Icon name={item.icon} />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.note && (
                        <span
                          className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium"
                          style={{ background: "rgb(255 255 255 / 0.12)" }}
                        >
                          {item.note}
                        </span>
                      )}
                    </span>
                  </li>
                );
              }

              const isActive = item.href === active;

              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors hover:bg-white/10"
                    style={{
                      background: isActive ? "#ffffff" : undefined,
                      color: isActive ? "var(--accent)" : "rgb(255 255 255 / 0.84)",
                      fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    <Icon name={item.icon} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand({ schoolName, portalName }: { schoolName: string; portalName: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4">
      {/* The monogram stands in for a logo until the school supplies one
          (decision 3). A white square on the maroon reads as deliberate, where
          an empty space reads as a missing image. */}
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-[0.625rem] text-sm font-bold"
        style={{ background: "#ffffff", color: "var(--accent)" }}
      >
        {schoolName.trim().charAt(0).toUpperCase() || "S"}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white">{schoolName}</span>
        <span className="block truncate text-xs" style={{ color: "rgb(255 255 255 / 0.64)" }}>
          {portalName}
        </span>
      </span>
    </div>
  );
}

export function DesktopSidebar({
  portalName,
  schoolName,
  groups,
}: {
  portalName: string;
  schoolName: string;
  groups: NavGroup[];
}) {
  return (
    <aside
      className="on-accent no-print fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-width)] flex-col lg:flex"
      style={{ background: "var(--accent)" }}
    >
      <Brand schoolName={schoolName} portalName={portalName} />
      <SidebarNav groups={groups} portalName={portalName} />
    </aside>
  );
}

export function MobileDrawer({
  portalName,
  schoolName,
  groups,
}: {
  portalName: string;
  schoolName: string;
  groups: NavGroup[];
}) {
  const pathname = usePathname();

  /*
   * The drawer is open only for the route it was opened on.
   *
   * Tapping a link navigates underneath an open drawer, and landing on the new
   * page still looking at the menu feels like the tap did nothing. Storing the
   * route it was opened on, rather than a bare boolean closed by an effect,
   * closes it on any navigation — including the back button — without a render
   * that sets state after the fact.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt !== null && openedAt === pathname;

  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedAt(null);
    };
    window.addEventListener("keydown", onKey);

    // The page must not scroll behind an open drawer.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="portal-drawer"
        className="no-print inline-flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-medium"
        style={{
          borderColor: "var(--line-strong)",
          background: "var(--surface-raised)",
          color: "var(--text-primary)",
        }}
      >
        <Icon name="menu" size={18} />
        Menu
      </button>

      {/*
       * The sheet is PORTALLED to <body>, not rendered here.
       *
       * The trigger lives in the top bar, and that bar is frosted with a
       * backdrop-filter. A filtered element becomes the containing block for
       * any `position: fixed` descendant, so a drawer rendered in place was
       * clipped to the height of the bar — it opened as a 56-pixel sliver with
       * the page showing through underneath. Nothing about the CSS was wrong;
       * the drawer was simply in the wrong part of the tree.
       */}
      {open &&
        createPortal(
          <div className="no-print fixed inset-0 z-50 lg:hidden">
            {/* The scrim. Tapping it closes, which is the gesture people try
                first — and it is a button, so the keyboard reaches it too. */}
            <button
              type="button"
              aria-label="Close the menu"
              onClick={() => setOpenedAt(null)}
              className="absolute inset-0"
              style={{ background: "rgb(26 20 18 / 0.5)" }}
            />

            <div
              id="portal-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={`${portalName} menu`}
              className="on-accent absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col"
              style={{ background: "var(--accent)", boxShadow: "var(--shadow-overlay)" }}
            >
              <div className="flex items-start justify-between">
                <Brand schoolName={schoolName} portalName={portalName} />
                <button
                  type="button"
                  onClick={() => setOpenedAt(null)}
                  aria-label="Close the menu"
                  className="m-3 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)]"
                  style={{ background: "rgb(255 255 255 / 0.14)", color: "#ffffff" }}
                >
                  <Icon name="close" size={18} />
                </button>
              </div>

              <SidebarNav groups={groups} portalName={portalName} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
