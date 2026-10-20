import type { NavGroup } from "@/components/nav";

/**
 * Teacher navigation.
 *
 * Attendance and marks come first and are grouped as "Teaching", because they
 * are what a teacher opens this product to do — several times a day for
 * attendance. Everything else is reference material they consult.
 */
export const TEACHER_NAV: NavGroup[] = [
  {
    title: "",
    items: [{ label: "Today", href: "/teacher", icon: "dashboard" }],
  },
  {
    title: "Teaching",
    items: [
      { label: "Attendance", href: "/teacher/attendance", icon: "check" },
      { label: "Marks", href: "/teacher/marks", icon: "exam" },
      { label: "Class tests", href: "/teacher/class-tests", icon: "clipboard" },
    ],
  },
  {
    title: "Reference",
    items: [
      { label: "Routine", href: "/teacher/routine", icon: "calendar" },
      { label: "Library", href: "/teacher/library", icon: "book" },
    ],
  },
  {
    title: "Me",
    items: [
      {
        label: "My attendance & leave",
        note: "pending",
        icon: "profile",
      },
    ],
  },
];
