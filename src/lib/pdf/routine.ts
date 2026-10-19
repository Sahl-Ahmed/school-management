import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * A4 routine PDFs, generated server-side with pdf-lib.
 *
 * Real downloadable files rather than a print-to-PDF page, because the brief
 * asks for a combined school-wide A4 PDF and separate per-class A4 PDFs that
 * the office can download and keep.
 *
 * ONE IMPORTANT LIMITATION, stated here and in the docs rather than discovered
 * later: pdf-lib's StandardFonts are WinAnsi-encoded and cannot render Bangla.
 * The routine prints subject names and teachers' Latin names, which is correct
 * for the owner's "English first" decision, but any Bangla character would
 * throw. `latin()` below replaces unsupported characters rather than crashing,
 * and the caller reports when that happened. Printing Bangla needs an embedded
 * Unicode font (Noto Sans Bengali via @pdf-lib/fontkit), which is deferred
 * until the owner confirms the Bangla locale.
 */

// A4 at 72dpi, in points.
const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 36; // 12.7mm — comfortable on a school printer

const INK = rgb(0.07, 0.09, 0.08);
const MUTED = rgb(0.42, 0.44, 0.43);
const HAIRLINE = rgb(0.78, 0.8, 0.79);
const HEADER_FILL = rgb(0.94, 0.96, 0.95);

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

export type SchoolBranding = {
  name: string;
  address: string | null;
  office_phone: string | null;
  email: string | null;
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Replaces characters the standard fonts cannot encode.
 *
 * Returns the count so the caller can tell the user their PDF is missing
 * glyphs, instead of silently handing over a document full of question marks.
 */
/**
 * Characters above U+00FF that WinAnsi (CP1252) nonetheless encodes, in its
 * 0x80-0x9F range. Rejecting these as "non-Latin" was wrong: the first version
 * of this function dropped the em dashes in the PDF's own title, so a routine
 * printed "Class Routine ? Class 3" while reporting two lost glyphs.
 */
const CP1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
  0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
  0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

function latin(text: string): { text: string; dropped: number } {
  let dropped = 0;
  const out = [...text]
    .map((ch) => {
      const code = ch.codePointAt(0)!;

      // Printable Latin-1, plus the CP1252 extras the standard fonts handle.
      const encodable =
        (code >= 0x20 && code <= 0xff) || CP1252_EXTRAS.has(code);

      if (!encodable) {
        dropped += 1;
        return "?";
      }
      return ch;
    })
    .join("");
  return { text: out, dropped };
}

/** Draws text, substituting unsupported characters, and counts the losses. */
function drawText(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color?: typeof INK },
): number {
  const { text: safe, dropped } = latin(text);
  page.drawText(safe, {
    x: opts.x,
    y: opts.y,
    size: opts.size,
    font: opts.font,
    color: opts.color ?? INK,
  });
  return dropped;
}

/**
 * Truncates to fit a column, adding an ellipsis when it does not.
 *
 * Returns the dropped-glyph count as well as the text. An earlier version
 * returned only the string, so by the time drawText saw it every unsupported
 * character had already become "?" and the glyph counter reported zero — which
 * made the Bangla warning useless in exactly the cells that carry subject and
 * teacher names.
 */
function fit(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): { text: string; dropped: number } {
  const { text: safe, dropped } = latin(text);
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return { text: safe, dropped };

  let cut = safe;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return { text: `${cut}...`, dropped };
}

type Fonts = { regular: PDFFont; bold: PDFFont };

/**
 * Shared page header: school name, document title, period.
 *
 * Returns the dropped-glyph count alongside the new y position. An earlier
 * version returned only y and discarded the count, which meant a Bangla school
 * NAME would silently print as question marks with no warning — the same bug
 * the fit() helper had.
 */
function drawHeader(
  page: PDFPage,
  fonts: Fonts,
  school: SchoolBranding,
  title: string,
  subtitle: string,
): { y: number; dropped: number } {
  let dropped = 0;
  let y = A4.height - MARGIN;

  dropped += drawText(page, school.name, {
    x: MARGIN, y: y - 14, size: 15, font: fonts.bold,
  });

  const contact = [school.address, school.office_phone, school.email]
    .filter(Boolean)
    .join("  ·  ");
  if (contact) {
    dropped += drawText(page, contact, {
      x: MARGIN, y: y - 28, size: 7.5, font: fonts.regular, color: MUTED,
    });
  }

  dropped += drawText(page, title, {
    x: MARGIN, y: y - 48, size: 11, font: fonts.bold,
  });
  dropped += drawText(page, subtitle, {
    x: MARGIN, y: y - 61, size: 8, font: fonts.regular, color: MUTED,
  });

  y -= 70;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 1,
    color: INK,
  });

  return { y: y - 12, dropped };
}

/** Footer: generation timestamp and page number. */
function drawFooter(page: PDFPage, fonts: Fonts, generatedAt: string, pageNo: number, pageCount: number) {
  drawText(page, `Generated ${generatedAt}`, {
    x: MARGIN, y: MARGIN - 14, size: 7, font: fonts.regular, color: MUTED,
  });
  const label = `Page ${pageNo} of ${pageCount}`;
  const width = fonts.regular.widthOfTextAtSize(label, 7);
  drawText(page, label, {
    x: A4.width - MARGIN - width, y: MARGIN - 14, size: 7,
    font: fonts.regular, color: MUTED,
  });
}

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
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

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
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

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
