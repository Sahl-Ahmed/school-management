import type { NavItem } from "@/components/portal-shell";

/**
 * Authority navigation, in one place so a section becomes reachable by editing
 * a single line when its phase lands. An item with no href renders greyed out
 * rather than linking to a page that 404s.
 */
export const AUTHORITY_NAV: NavItem[] = [
  { label: "Dashboard", href: "/authority" },
  { label: "Students", href: "/authority/students" },
  { label: "Teachers", href: "/authority/teachers" },
  { label: "Routine", href: "/authority/routine" },
  { label: "Fees", note: "phase 4" },
  { label: "Exams", note: "phase 5" },
  { label: "Documents", note: "phase 6" },
  { label: "Notifications", note: "phase 7" },
];
