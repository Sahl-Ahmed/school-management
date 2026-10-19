import type { NavItem } from "@/components/portal-shell";

/** Teacher navigation. An item with no href is not built yet. */
export const TEACHER_NAV: NavItem[] = [
  { label: "Today", href: "/teacher" },
  { label: "Attendance", href: "/teacher/attendance" },
  { label: "Routine", href: "/teacher/routine" },
  { label: "Marks", note: "phase 5" },
  { label: "Class tests", note: "phase 5" },
  { label: "Library", note: "phase 7" },
  { label: "My attendance & leave", note: "phase 8" },
];
