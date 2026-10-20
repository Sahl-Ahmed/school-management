import { signOut } from "@/app/login/actions";
import { Icon } from "@/components/icon";
import { DesktopSidebar, MobileDrawer } from "@/components/portal-sidebar";
import type { NavGroup } from "@/components/nav";

export type { NavItem, NavGroup } from "@/components/nav";

/**
 * Shared chrome for the three portals.
 *
 * One visual language across Authority, Teacher and Student: the same sidebar,
 * the same top bar, the same surfaces. Role is distinguished by what is IN the
 * navigation, never by a different colour per portal — a student should
 * recognise the product their teacher uses.
 *
 * The layout is a fixed maroon sidebar and a cream content column. Confining
 * the maroon to the sidebar is deliberate: it is a strong colour, and painting
 * it across the header too stops the thing feeling like a workspace and starts
 * it feeling like a brochure. Content lives on white cards floating on the
 * cream, which is the one rule the whole interface is built from.
 *
 * On narrow screens the sidebar becomes a drawer opened from the top bar, and
 * the content column takes the full width rather than squeezing beside a
 * collapsed rail — a school office on a phone needs all of it for a roster.
 */
export function PortalShell({
  portalName,
  userName,
  nav,
  schoolName = "School",
  children,
}: {
  portalName: string;
  userName: string;
  nav: NavGroup[];
  schoolName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <DesktopSidebar portalName={portalName} schoolName={schoolName} groups={nav} />

      {/* The content column clears the fixed sidebar from `lg` upwards. */}
      <div className="lg:pl-[var(--sidebar-width)]">
        <header
          className="no-print sticky top-0 z-20"
          style={{
            borderBottom: "1px solid var(--line-hairline)",
            background: "color-mix(in srgb, var(--surface) 88%, transparent)",
            backdropFilter: "saturate(180%) blur(10px)",
          }}
        >
          <div
            className="mx-auto flex items-center justify-between gap-3 px-4 sm:px-6"
            style={{ minHeight: "var(--topbar-height)", maxWidth: "var(--content-max)" }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <MobileDrawer portalName={portalName} schoolName={schoolName} groups={nav} />
              {/* On desktop the sidebar already names the portal, so the top
                  bar carries it only as a quiet echo for orientation. */}
              <span
                className="hidden truncate text-sm font-semibold lg:block"
                style={{ color: "var(--text-secondary)" }}
              >
                {portalName}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <span
                className="hidden max-w-[16rem] truncate text-sm sm:inline"
                style={{ color: "var(--text-secondary)" }}
              >
                {userName}
              </span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-medium transition-colors"
                  style={{
                    borderColor: "var(--line-strong)",
                    background: "var(--surface-raised)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <Icon name="signout" size={16} />
                  <span className="hidden sm:inline">Sign out</span>
                  <span className="sr-only sm:hidden">Sign out</span>
                </button>
              </form>
            </div>
          </div>
        </header>

        <main
          className="mx-auto px-4 py-6 sm:px-6 sm:py-8"
          style={{ maxWidth: "var(--content-max)" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
