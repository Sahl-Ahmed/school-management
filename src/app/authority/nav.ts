import type { NavGroup } from "@/components/nav";

/**
 * Authority navigation.
 *
 * Grouped by what the work IS, not by the order the phases were built in. The
 * office does four distinct jobs — it keeps records of people, it runs the
 * timetable and the money, it runs exams, and it sends things out — and a flat
 * list of eleven links made the reader sort them mentally every time.
 *
 * An item with no href is not built yet. It renders dimmed with its note rather
 * than linking to a page that 404s.
 */
export const AUTHORITY_NAV: NavGroup[] = [
  {
    title: "",
    items: [{ label: "Dashboard", href: "/authority", icon: "dashboard" }],
  },
  {
    title: "People",
    items: [
      { label: "Students", href: "/authority/students", icon: "students" },
      { label: "Teachers", href: "/authority/teachers", icon: "teachers" },
    ],
  },
  {
    title: "Day to day",
    items: [
      { label: "Routine", href: "/authority/routine", icon: "calendar" },
      { label: "Fees", href: "/authority/fees", icon: "money" },
      { label: "Library", href: "/authority/library", icon: "book" },
    ],
  },
  {
    title: "Exams",
    items: [
      { label: "Exams", href: "/authority/exams", icon: "exam" },
      { label: "Grading policy", href: "/authority/grading", icon: "grade" },
      { label: "Cards & printables", href: "/authority/cards", icon: "card" },
    ],
  },
  {
    title: "Communication",
    items: [
      { label: "Teacher feedback", href: "/authority/feedback", icon: "feedback" },
      { label: "Notifications", href: "/authority/notifications", icon: "bell" },
    ],
  },
];
