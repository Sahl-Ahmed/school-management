"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/components/portal-shell";

/**
 * The portal's section navigation.
 *
 * A client component purely so it can read the current pathname and mark the
 * active section — the shell around it stays a Server Component.
 *
 * Active state is a green underline rather than a filled pill: the header is
 * one of the few places where a solid accent block would fight the white
 * surface the design calls for, and an underline reads as "you are here"
 * without turning the chrome into a colour field.
 *
 * An item with no href is a section whose phase has not landed. It renders as
 * a disabled label, because a link that 404s reads as a broken product while a
 * greyed-out item reads as a roadmap.
 */
export function PortalNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  /** Longest matching href wins, so /teacher/attendance does not light up /teacher. */
  const activeHref = items
    .map((i) => i.href)
    .filter((href): href is NonNullable<typeof href> => Boolean(href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => String(b).length - String(a).length)[0];

  return (
    <nav aria-label="Sections" className="mx-auto max-w-6xl overflow-x-auto px-4">
      <ul className="flex gap-0.5">
        {items.map((item) => {
          if (!item.href) {
            return (
              <li key={item.label}>
                <span
                  aria-disabled="true"
                  title={item.note ? `Not built yet — ${item.note}` : "Not built yet"}
                  className="block cursor-not-allowed whitespace-nowrap px-3 py-2.5 text-sm"
                  style={{ color: "var(--text-muted)", opacity: 0.55 }}
                >
                  {item.label}
                </span>
              </li>
            );
          }

          const active = item.href === activeHref;

          return (
            <li key={item.label}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="block whitespace-nowrap px-3 py-2.5 text-sm transition-colors"
                style={{
                  color: active ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: active ? 600 : 500,
                  boxShadow: active ? "inset 0 -2px 0 0 var(--accent)" : undefined,
                }}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
