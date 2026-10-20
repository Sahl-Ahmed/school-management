import "server-only";

/**
 * A4 routine PDFs, generated server-side with pdf-lib.
 *
 * Real downloadable files rather than a print-to-PDF page, because the brief
 * asks for a combined school-wide A4 PDF and separate per-class A4 PDFs that
 * the office can download and keep.
 *
 * The fonts, the regeneratorRuntime polyfill, and the text helpers that make
 * Bengali shape correctly all live in ./base, shared with the admit card, ID
 * card, exam routine, receipt and result sheet generators. The long-form
 * explanation of why the polyfill is needed is there too.
 */

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
  type Fonts,
  type PDFPage,
  type SchoolBranding,
} from "./base";

export type { SchoolBranding };

export type RoutinePeriod = {
  weekday: number;
  period_no: number;
  starts_at: string;
  ends_at: string;
  subject_name: string;
  teacher_name: string;
};

export type RoutineSection = {
  class_name: string;
  section_name: string;
  level_order: number;
  periods: RoutinePeriod[];
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Draws one section's weekly grid and returns the y position below it.
 *
 * Weekdays are rows and periods are columns, matching the on-screen grid, so a
 * printed sheet and the website read the same way.
 */
function drawRoutineTable(
  page: PDFPage,
  fonts: Fonts,
  startY: number,
  periods: RoutinePeriod[],
  teachingDays: number[],
  opts: { compact?: boolean } = {},
): { y: number; dropped: number } {
  let dropped = 0;

  const periodNos = [...new Set(periods.map((p) => p.period_no))].sort((a, b) => a - b);
  if (periodNos.length === 0) {
    dropped += drawText(page, "No periods scheduled.", {
      x: MARGIN, y: startY - 12, size: 8.5, font: fonts.regular, color: MUTED,
    });
    return { y: startY - 24, dropped };
  }

  const dayColWidth = opts.compact ? 30 : 42;
  const tableWidth = A4.width - MARGIN * 2;
  const colWidth = (tableWidth - dayColWidth) / periodNos.length;
  const rowHeight = opts.compact ? 26 : 32;
  const headerHeight = opts.compact ? 20 : 24;
  const fontSize = opts.compact ? 6 : 7;

  // Earliest start/end per period number, for the time label.
  const timeFor = new Map<number, { starts_at: string; ends_at: string }>();
  for (const p of periods) {
    const existing = timeFor.get(p.period_no);
    if (!existing || p.starts_at < existing.starts_at) {
      timeFor.set(p.period_no, { starts_at: p.starts_at, ends_at: p.ends_at });
    }
  }

  let y = startY;

  // --- header row ---
  page.drawRectangle({
    x: MARGIN, y: y - headerHeight, width: tableWidth, height: headerHeight,
    color: HEADER_FILL,
  });

  dropped += drawText(page, "Day", {
    x: MARGIN + 4, y: y - headerHeight + (opts.compact ? 7 : 9),
    size: fontSize + 0.5, font: fonts.bold,
  });

  periodNos.forEach((no, i) => {
    const x = MARGIN + dayColWidth + i * colWidth;
    dropped += drawText(page, `Period ${no}`, {
      x: x + 3, y: y - 11, size: fontSize + 0.5, font: fonts.bold,
    });
    const t = timeFor.get(no)!;
    dropped += drawText(page, `${t.starts_at.slice(0, 5)}-${t.ends_at.slice(0, 5)}`, {
      x: x + 3, y: y - 19, size: fontSize - 0.5, font: fonts.regular, color: MUTED,
    });
  });

  y -= headerHeight;

  // --- body rows ---
  for (const day of teachingDays) {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + tableWidth, y },
      thickness: 0.5,
      color: HAIRLINE,
    });

    dropped += drawText(page, WEEKDAY_SHORT[day]!, {
      x: MARGIN + 4, y: y - rowHeight / 2 - 2, size: fontSize, font: fonts.bold,
    });

    periodNos.forEach((no, i) => {
      const x = MARGIN + dayColWidth + i * colWidth;
      const cell = periods.find((p) => p.weekday === day && p.period_no === no);

      if (!cell) {
        // An explicit dash, so a blank cell is never read as missing data.
        dropped += drawText(page, "-", {
          x: x + 3, y: y - rowHeight / 2 - 2, size: fontSize,
          font: fonts.regular, color: HAIRLINE,
        });
        return;
      }

      const subject = fit(cell.subject_name, fonts.bold, fontSize, colWidth - 6);
      const teacher = fit(cell.teacher_name, fonts.regular, fontSize - 0.5, colWidth - 6);

      // The dropped counts come from fit(), because drawText only ever sees
      // the already-sanitised string.
      dropped += subject.dropped + teacher.dropped;

      drawText(page, subject.text, {
        x: x + 3, y: y - (opts.compact ? 10 : 12), size: fontSize, font: fonts.bold,
      });
      drawText(page, teacher.text, {
        x: x + 3, y: y - (opts.compact ? 18 : 22), size: fontSize - 0.5,
        font: fonts.regular, color: MUTED,
      });
    });

    y -= rowHeight;
  }

  // Closing line and column rules.
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: MARGIN + tableWidth, y },
    thickness: 1, color: INK,
  });
  for (let i = 0; i <= periodNos.length; i += 1) {
    const x = MARGIN + dayColWidth + i * colWidth;
    page.drawLine({
      start: { x, y: startY }, end: { x, y },
      thickness: 0.5, color: HAIRLINE,
    });
  }

  return { y: y - 10, dropped };
}

export type PdfResult = { bytes: Uint8Array; droppedGlyphs: number };

/** One A4 page for a single class/section. */
export async function buildSectionRoutinePdf(
  school: SchoolBranding,
  section: RoutineSection,
  teachingDays: number[],
  academicYear: string,
  generatedAt: string,
): Promise<PdfResult> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);

  const page = doc.addPage([A4.width, A4.height]);
  let dropped = 0;

  const label = `${section.class_name}${section.section_name ? ` — Section ${section.section_name}` : ""}`;
  const header = drawHeader(
    page, fonts, school,
    `Class Routine — ${label}`,
    `Academic year ${academicYear}`,
  );
  dropped += header.dropped;

  const table = drawRoutineTable(page, fonts, header.y, section.periods, teachingDays);
  dropped += table.dropped;

  drawFooter(page, fonts, generatedAt, 1, 1);

  doc.setTitle(`Class Routine - ${label}`);
  doc.setAuthor(school.name);
  doc.setCreator("School Management");

  return { bytes: await doc.save(), droppedGlyphs: dropped };
}

/**
 * The combined school-wide routine.
 *
 * Several sections per A4 page, in class order, breaking to a new page when the
 * next grid would not fit. The brief asks for a combined routine that FITS an
 * A4 sheet, so the layout measures remaining space rather than assuming.
 */
export async function buildSchoolRoutinePdf(
  school: SchoolBranding,
  sections: RoutineSection[],
  teachingDays: number[],
  academicYear: string,
  generatedAt: string,
): Promise<PdfResult> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);

  let dropped = 0;
  const pages: PDFPage[] = [];

  let page = doc.addPage([A4.width, A4.height]);
  pages.push(page);
  let header = drawHeader(
    page, fonts, school,
    "School-wide Class Routine",
    `Academic year ${academicYear} — all classes`,
  );
  dropped += header.dropped;
  let y = header.y;

  const withPeriods = sections.filter((s) => s.periods.length > 0);

  if (withPeriods.length === 0) {
    dropped += drawText(page, "No routine has been set for any class yet.", {
      x: MARGIN, y: y - 14, size: 9, font: fonts.regular, color: MUTED,
    });
  }

  for (const section of withPeriods) {
    const rows = teachingDays.length;
    // Title + header row + body rows + spacing.
    const estimatedHeight = 16 + 20 + rows * 26 + 18;

    if (y - estimatedHeight < MARGIN + 20) {
      page = doc.addPage([A4.width, A4.height]);
      pages.push(page);
      header = drawHeader(
        page, fonts, school,
        "School-wide Class Routine (continued)",
        `Academic year ${academicYear}`,
      );
      dropped += header.dropped;
      y = header.y;
    }

    const label = `${section.class_name}${section.section_name ? ` — Section ${section.section_name}` : ""}`;
    dropped += drawText(page, label, {
      x: MARGIN, y: y - 11, size: 9, font: fonts.bold,
    });
    y -= 16;

    const table = drawRoutineTable(page, fonts, y, section.periods, teachingDays, {
      compact: true,
    });
    dropped += table.dropped;
    y = table.y - 8;
  }

  pages.forEach((p, i) => drawFooter(p, fonts, generatedAt, i + 1, pages.length));

  doc.setTitle("School-wide Class Routine");
  doc.setAuthor(school.name);
  doc.setCreator("School Management");

  return { bytes: await doc.save(), droppedGlyphs: dropped };
}

/** A4 dimensions in points, exported so tests can assert page geometry. */
export const A4_POINTS = A4;
