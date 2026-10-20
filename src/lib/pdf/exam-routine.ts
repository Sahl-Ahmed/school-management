import "server-only";

import {
  A4,
  HAIRLINE,
  HEADER_FILL,
  INK,
  MARGIN,
  MUTED,
  PDFDocument,
  drawFooter,
  drawHeader,
  drawText,
  embedFonts,
  fit,
  hhmm,
  prettyDate,
  type SchoolBranding,
} from "./base";

/**
 * The printable exam schedule.
 *
 * Grouped by date rather than by class, because that is how it is read: a
 * notice board copy answers "what is tomorrow", and a parent reads down the
 * dates looking for their child's class. Grouping by class would make the same
 * information require a scan of every block to answer either question.
 *
 * A subject with no date is not hidden — it is listed under "Date not set", so
 * an incomplete schedule is visibly incomplete on the sheet the office is
 * about to pin up.
 */

export type ExamRoutineRow = {
  class_name: string;
  level_order: number;
  subject: string;
  subject_bn: string | null;
  exam_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  room: string | null;
  max_marks: number | string;
};

export type ExamRoutineInput = {
  school: SchoolBranding;
  exam: {
    name: string;
    term_name: string;
    academic_year: string;
    starts_on: string | null;
    ends_on: string | null;
    routine_published_at: string | null;
  };
  rows: ExamRoutineRow[];
  /** When set, the sheet is restricted to one class and says so. */
  classFilter?: string | null;
  generatedAt: string;
};

export async function buildExamRoutinePdf(
  input: ExamRoutineInput,
): Promise<{ bytes: Uint8Array; dropped: number; pages: number }> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);

  doc.setTitle(`${input.exam.name} — exam routine`);
  doc.setCreator(input.school.name);

  let dropped = 0;

  // Grouped by date, with undated subjects last under their own heading.
  const groups = new Map<string, ExamRoutineRow[]>();
  for (const row of input.rows) {
    const key = row.exam_date ?? "";
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    return a.localeCompare(b);
  });

  const subtitle = [
    input.exam.term_name,
    input.exam.academic_year,
    input.classFilter ? `${input.classFilter} only` : "all classes",
    input.exam.routine_published_at ? null : "NOT YET PUBLISHED TO STUDENTS",
  ]
    .filter(Boolean)
    .join("  ·  ");

  const pages: ReturnType<typeof doc.addPage>[] = [];
  let page = doc.addPage([A4.width, A4.height]);
  pages.push(page);

  let header = drawHeader(page, fonts, input.school, `${input.exam.name} — Exam Routine`, subtitle);
  dropped += header.dropped;
  let y = header.y;

  const colClass = MARGIN;
  const colSubject = MARGIN + 92;
  const colTime = A4.width - MARGIN - 190;
  const colRoom = A4.width - MARGIN - 96;
  const colMarks = A4.width - MARGIN - 34;

  const newPage = () => {
    page = doc.addPage([A4.width, A4.height]);
    pages.push(page);
    header = drawHeader(page, fonts, input.school, `${input.exam.name} — Exam Routine`, subtitle);
    dropped += header.dropped;
    y = header.y;
  };

  if (input.rows.length === 0) {
    dropped += drawText(page, "No subjects are configured for this exam yet.", {
      x: MARGIN, y: y - 14, size: 10, font: fonts.regular, color: MUTED,
    });
  }

  for (const key of keys) {
    const rows = groups.get(key)!;

    // A date block needs its heading plus at least one row on the same page,
    // otherwise the heading strands at the bottom.
    if (y < MARGIN + 60) newPage();

    // --- date heading ---
    page.drawRectangle({
      x: MARGIN, y: y - 16, width: A4.width - MARGIN * 2, height: 18,
      color: HEADER_FILL,
    });
    dropped += drawText(page, key ? prettyDate(key) : "Date not set", {
      x: MARGIN + 6, y: y - 11, size: 9.5, font: fonts.bold,
    });
    dropped += drawText(page, `${rows.length} paper${rows.length === 1 ? "" : "s"}`, {
      x: A4.width - MARGIN - 60, y: y - 11, size: 7.5, font: fonts.regular, color: MUTED,
    });
    y -= 22;

    // --- column headings ---
    for (const [label, x] of [
      ["Class", colClass], ["Subject", colSubject], ["Time", colTime],
      ["Room", colRoom], ["Marks", colMarks],
    ] as [string, number][]) {
      dropped += drawText(page, label, {
        x, y, size: 7, font: fonts.bold, color: MUTED,
      });
    }
    y -= 4;
    page.drawLine({
      start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y },
      thickness: 0.6, color: HAIRLINE,
    });
    y -= 12;

    const sorted = [...rows].sort(
      (a, b) =>
        (a.starts_at ?? "").localeCompare(b.starts_at ?? "") ||
        a.level_order - b.level_order ||
        a.subject.localeCompare(b.subject),
    );

    for (const row of sorted) {
      if (y < MARGIN + 24) {
        newPage();
        y -= 4;
      }

      const cls = fit(row.class_name, fonts.bold, 8.5, colSubject - colClass - 6);
      dropped += cls.dropped;
      dropped += drawText(page, cls.text, {
        x: colClass, y, size: 8.5, font: fonts.bold,
      });

      // The Bangla subject name beside the English one, when recorded, since
      // the parents reading a notice board copy may only read Bangla.
      const label = row.subject_bn ? `${row.subject}  ·  ${row.subject_bn}` : row.subject;
      const subject = fit(label, fonts.regular, 8.5, colTime - colSubject - 8);
      dropped += subject.dropped;
      dropped += drawText(page, subject.text, {
        x: colSubject, y, size: 8.5, font: fonts.regular,
      });

      dropped += drawText(
        page,
        row.starts_at ? `${hhmm(row.starts_at)} – ${hhmm(row.ends_at)}` : "—",
        { x: colTime, y, size: 8.5, font: fonts.regular },
      );

      const room = fit(row.room ?? "—", fonts.regular, 8.5, colMarks - colRoom - 6);
      dropped += room.dropped;
      dropped += drawText(page, room.text, {
        x: colRoom, y, size: 8.5, font: fonts.regular,
      });

      dropped += drawText(page, String(Number(row.max_marks)), {
        x: colMarks, y, size: 8.5, font: fonts.regular,
      });

      y -= 13;
    }

    y -= 8;
  }

  // The unpublished warning is repeated at the foot of every page, because a
  // single sheet pulled from the stack must still carry it.
  pages.forEach((p, i) => {
    if (!input.exam.routine_published_at) {
      drawText(p, "Draft — this routine is not yet visible to students.", {
        x: MARGIN, y: MARGIN - 24, size: 7, font: fonts.bold, color: INK,
      });
    }
    drawFooter(p, fonts, input.generatedAt, i + 1, pages.length);
  });

  return { bytes: await doc.save(), dropped, pages: pages.length };
}
