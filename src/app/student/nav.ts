import type { NavItem } from "@/components/portal-shell";

/** Student navigation. An item with no href is not built yet. */
export const STUDENT_NAV: NavItem[] = [
  { label: "My profile", href: "/student" },
  { label: "Attendance", href: "/student/attendance" },
  { label: "Routine", href: "/student/routine" },
  { label: "Fees", note: "phase 4" },
  { label: "Results", note: "phase 5" },
  { label: "Teacher feedback", note: "phase 6" },
  { label: "Library", note: "phase 7" },
  { label: "ID & admit card", note: "phase 6" },
];
