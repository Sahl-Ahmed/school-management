import type { Tone } from "@/components/charts";

/**
 * The exam lifecycle, described in the words the office uses.
 *
 * Kept in one place because the same five states appear on the list, on the
 * detail page and on the status control, and a mismatch between them would
 * read as three different systems.
 */
export type ExamStatus =
  | "draft"
  | "scheduled"
  | "marks_open"
  | "marks_closed"
  | "published";

export const EXAM_STATUS: Record<ExamStatus, { label: string; tone: Tone; meaning: string }> = {
  draft: {
    label: "Draft",
    tone: "neutral",
    meaning: "Still being configured. Teachers and students see nothing.",
  },
  scheduled: {
    label: "Scheduled",
    tone: "accent",
    meaning: "Subjects and dates are set. Mark entry is not open.",
  },
  marks_open: {
    label: "Marks open",
    tone: "warn",
    meaning: "Assigned teachers may enter marks now.",
  },
  marks_closed: {
    label: "Marks closed",
    tone: "accent",
    meaning: "Entry is locked and the office is reviewing. Results are not published.",
  },
  published: {
    label: "Published",
    tone: "good",
    meaning: "Results are visible to students and guardians.",
  },
};

/** The states the authority may set directly. `published` is not one of them. */
export const SETTABLE_STATUSES: ExamStatus[] = [
  "draft",
  "scheduled",
  "marks_open",
  "marks_closed",
];
