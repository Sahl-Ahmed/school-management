import type { Route } from "next";
import type { IconName } from "@/components/icon";

/**
 * The shape of portal navigation.
 *
 * Grouped, because a flat list of nine items in a sidebar is a wall: the office
 * portal has a dashboard, two kinds of people, a routine, money, exams, two
 * kinds of outgoing communication and a library, and those fall into obvious
 * piles. Grouping them is the difference between scanning and reading.
 *
 * Each portal declares its own groups rather than deriving them from the role,
 * so adding a link is a deliberate act in one file and cannot accidentally
 * surface another portal's route.
 */

export type NavItem = {
  label: string;
  /** Omit for a section that is not built yet. */
  href?: Route;
  /** Short note shown on an unbuilt section, e.g. "pending". */
  note?: string;
  icon: IconName;
};

export type NavGroup = {
  /**
   * The group heading.
   *
   * An empty title renders the group with no heading, which is right for the
   * single dashboard item at the top: a heading above one link reads as
   * bureaucracy.
   */
  title: string;
  items: NavItem[];
};
