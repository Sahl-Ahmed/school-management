import type { NavItem } from "@/components/portal-shell";

/** Student navigation. An item with no href is not built yet. */
export const STUDENT_NAV: NavItem[] = [
  { label: "My profile", href: "/student" },
  { label: "Attendance", href: "/student/attendance" },
  { label: "Routine", href: "/student/routine" },
  { label: "Fees", href: "/student/fees" },
  { label: "Results", href: "/student/results" },
  { label: "Teacher feedback", href: "/student/feedback" },
  { label: "Library", note: "phase 7" },
  { label: "ID & admit card", href: "/student/documents" },
];
