import { PortalShell } from "@/components/portal-shell";
import { Card, PageSections, Skeleton, SkeletonTable } from "@/components/ui";
import type { NavGroup } from "@/components/nav";

/**
 * What a portal shows while a page is being fetched.
 *
 * These pages are `force-dynamic` — every one of them reads the signed-in
 * user's own rows — so a navigation always waits on the server. Before this,
 * that wait showed the previous page with nothing happening, which on a slow
 * connection reads as a dead tap.
 *
 * The sidebar is drawn here too rather than left blank: the navigation does not
 * depend on the data, so making it disappear for the duration of a fetch would
 * be a worse flash than the one it replaces. The user's own name is the one
 * thing not yet known, so it is simply left out.
 */
export function PortalLoading({
  portalName,
  nav,
  rows = 6,
  columns = 4,
}: {
  portalName: string;
  nav: NavGroup[];
  rows?: number;
  columns?: number;
}) {
  return (
    <PortalShell portalName={portalName} userName="" nav={nav}>
      <PageSections>
        <header className="mb-6" aria-hidden="true">
          <Skeleton width="14rem" height="1.75rem" />
          <Skeleton className="mt-3" width="22rem" height="0.875rem" />
        </header>

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <Skeleton width="7rem" height="0.75rem" />
              <Skeleton className="mt-3" width="4rem" height="1.75rem" />
              <Skeleton className="mt-3" width="9rem" height="0.75rem" />
            </Card>
          ))}
        </section>

        <Card padded={false}>
          <div
            className="px-5 py-4"
            style={{ borderBottom: "1px solid var(--line-on-white)" }}
            aria-hidden="true"
          >
            <Skeleton width="9rem" height="0.875rem" />
          </div>
          <SkeletonTable rows={rows} columns={columns} />
        </Card>

        {/* The only part that is not decoration: a screen reader is told the
            page is loading, which the shapes above cannot say. */}
        <p role="status" className="sr-only">
          Loading…
        </p>
      </PageSections>
    </PortalShell>
  );
}
