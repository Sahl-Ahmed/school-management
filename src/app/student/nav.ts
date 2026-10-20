import type { NavGroup } from "@/components/nav";

/**
 * Student navigation.
 *
 * "My work" is what the student is assessed on, "My school" is the practical
 * business of being enrolled. Feedback sits under work because completing it is
 * what releases an admit card — it is a task, not a courtesy.
 */
export const STUDENT_NAV: NavGroup[] = [
  {
    title: "",
    items: [{ label: "My profile", href: "/student", icon: "profile" }],
  },
  {
    title: "My work",
    items: [
      { label: "Attendance", href: "/student/attendance", icon: "check" },
      { label: "Results", href: "/student/results", icon: "chart" },
      { label: "Teacher feedback", href: "/student/feedback", icon: "feedback" },
    ],
  },
  {
    title: "My school",
    items: [
      { label: "Routine", href: "/student/routine", icon: "calendar" },
      { label: "Fees", href: "/student/fees", icon: "money" },
      { label: "Library", href: "/student/library", icon: "book" },
      { label: "ID & admit card", href: "/student/documents", icon: "card" },
    ],
  },
];
