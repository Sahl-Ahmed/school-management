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
  { label: "Fees", href: "/authority/fees" },
  { label: "Exams", href: "/authority/exams" },
  { label: "Grading", href: "/authority/grading" },
  { label: "Feedback", href: "/authority/feedback" },
  { label: "Cards & printables", href: "/authority/cards" },
  { label: "Library", href: "/authority/library" },
  { label: "Notifications", href: "/authority/notifications" },
];
