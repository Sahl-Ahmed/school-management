import "server-only";

import {
  A4,
  ACCENT,
  BAD,
  HAIRLINE,
  HEADER_FILL,
  INK,
  MARGIN,
  MUTED,
  PDFDocument,
  drawCentred,
  drawRight,
  drawText,
  embedFonts,
  fit,
  hhmm,
  prettyDate,
  type Fonts,
  type PDFPage,
  type SchoolBranding,
} from "./base";

/**
 * Admit cards, three to an A4 sheet.
 *
 * Three per page is the brief's requirement and it drives the geometry: the
 * usable height between margins is divided in three, each card gets a cut line
 * below it, and the subject timetable inside a card is capped at what fits
 * rather than overflowing into the next card. A fourth subject row would push
 * into the neighbour, so the card lists what it can and prints
 * "+ N more — see the exam routine" instead of silently truncating.
 *
 * The seat code is printed large, because its whole purpose is to be read at a
 * hall door and matched against a list.
 */

export type AdmitSubject = {
  subject: string;
  subject_bn: string | null;
  exam_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  room: string | null;
  max_marks: number | string;
};

export type AdmitCard = {
  student: {
    full_name: string;
    full_name_bn: string | null;
    registration_no: string;
    roll_no: number;
    class_name: string;
    section_name: string | null;
    father_name: string;
    mother_name: string;
  };
  exam: {
    name: string;
    term_name: string;
    academic_year: string;
    starts_on: string | null;
    ends_on: string | null;
  };
  seat_token: string | null;
  subjects: AdmitSubject[];
  /** Printed as a warning band when the card is issued under an override. */
  overridden?: boolean;
};

export type AdmitCardInput = {
  school: SchoolBranding;
  cards: AdmitCard[];
  generatedAt: string;
};

/** Cards per sheet. The brief's requirement, and the geometry follows it. */
const PER_PAGE = 3;

/** How many timetable rows fit in one card before the overflow note. */
const MAX_SUBJECT_ROWS = 4;

const CARD_GAP = 10;

function cardHeight(): number {
  const usable = A4.height - MARGIN * 2;
  return (usable - CARD_GAP * (PER_PAGE - 1)) / PER_PAGE;
}

/**
 * Draws one admit card inside the given box.
 *
 * Returns the number of characters the font had no glyph for, which the caller
 * accumulates. A Bangla name that cannot be drawn must be reported rather than
 * printed as question marks on a document a student presents at a door.
 */
function drawCard(
  page: PDFPage,
  fonts: Fonts,
  school: SchoolBranding,
  card: AdmitCard,
  box: { x: number; y: number; width: number; height: number },
): number {
  let dropped = 0;
  const { x, y, width, height } = box;
  const right = x + width;

  // Card border.
  page.drawRectangle({
    x, y, width, height,
    borderColor: INK,
    borderWidth: 1,
  });

  // --- header band -------------------------------------------------------
  const bandHeight = 34;
  page.drawRectangle({
    x: x + 1,
    y: y + height - bandHeight - 1,
    width: width - 2,
    height: bandHeight,
    color: HEADER_FILL,
  });

  const schoolName = fit(school.name, fonts.bold, 11, width - 150);
  dropped += schoolName.dropped;
  dropped += drawText(page, schoolName.text, {
    x: x + 10, y: y + height - 16, size: 11, font: fonts.bold,
  });

  const contact = [school.address, school.office_phone].filter(Boolean).join("  ·  ");
  if (contact) {
    const line = fit(contact, fonts.regular, 6.5, width - 150);
    dropped += line.dropped;
    dropped += drawText(page, line.text, {
      x: x + 10, y: y + height - 27, size: 6.5, font: fonts.regular, color: MUTED,
    });
  }

  dropped += drawRight(page, "ADMIT CARD", {
    x: right - 10, y: y + height - 18, size: 10, font: fonts.bold, color: ACCENT,
  });
  dropped += drawRight(page, card.exam.academic_year, {
    x: right - 10, y: y + height - 28, size: 6.5, font: fonts.regular, color: MUTED,
  });

  // --- exam name ---------------------------------------------------------
  let cursor = y + height - bandHeight - 14;
  const examLine = fit(
    `${card.exam.name} · ${card.exam.term_name}`,
    fonts.bold, 9, width - 20,
  );
  dropped += examLine.dropped;
  dropped += drawText(page, examLine.text, {
    x: x + 10, y: cursor, size: 9, font: fonts.bold,
  });

  // --- student block, left column ---------------------------------------
  cursor -= 14;
  const labelX = x + 10;
  const valueX = x + 74;
  const leftWidth = width * 0.52;

  const rows: [string, string][] = [
    ["Name", card.student.full_name],
    ["Class", `${card.student.class_name}${card.student.section_name ? ` — ${card.student.section_name}` : ""}`],
    ["Roll", String(card.student.roll_no)],
    ["Registration", card.student.registration_no],
    ["Father", card.student.father_name],
    ["Mother", card.student.mother_name],
  ];

  for (const [label, value] of rows) {
    dropped += drawText(page, label, {
      x: labelX, y: cursor, size: 7, font: fonts.regular, color: MUTED,
    });
    const shown = fit(value, fonts.bold, 8, leftWidth - (valueX - x) - 6);
    dropped += shown.dropped;
    dropped += drawText(page, shown.text, {
      x: valueX, y: cursor, size: 8, font: fonts.bold,
    });
    cursor -= 11;
  }

  // The Bangla name, when the school records one, under the Latin rows.
  if (card.student.full_name_bn) {
    const bn = fit(card.student.full_name_bn, fonts.regular, 8, leftWidth - 20);
    dropped += bn.dropped;
    dropped += drawText(page, bn.text, {
      x: valueX, y: cursor, size: 8, font: fonts.regular, color: MUTED,
    });
    cursor -= 11;
  }

  // --- seat code, right column ------------------------------------------
  const seatBoxWidth = 120;
  const seatBoxX = right - 10 - seatBoxWidth;
  const seatBoxY = y + height - bandHeight - 62;

  page.drawRectangle({
    x: seatBoxX, y: seatBoxY, width: seatBoxWidth, height: 44,
    borderColor: HAIRLINE, borderWidth: 0.8,
  });
  dropped += drawCentred(page, "SEAT CODE", {
    x: seatBoxX + seatBoxWidth / 2, y: seatBoxY + 32, size: 6.5,
    font: fonts.regular, color: MUTED,
  });
  dropped += drawCentred(page, card.seat_token ?? "not issued", {
    x: seatBoxX + seatBoxWidth / 2, y: seatBoxY + 14,
    size: card.seat_token ? 14 : 9,
    font: fonts.bold,
    color: card.seat_token ? INK : BAD,
  });

  // Signature line for the invigilator, beneath the seat box.
  page.drawLine({
    start: { x: seatBoxX, y: seatBoxY - 16 },
    end: { x: seatBoxX + seatBoxWidth, y: seatBoxY - 16 },
    thickness: 0.6, color: HAIRLINE,
  });
  dropped += drawCentred(page, "Head teacher's signature", {
    x: seatBoxX + seatBoxWidth / 2, y: seatBoxY - 25, size: 6,
    font: fonts.regular, color: MUTED,
  });

  // --- the timetable -----------------------------------------------------
  const tableTop = Math.min(cursor, seatBoxY - 34) - 4;
  const colSubject = x + 10;
  const colDate = x + width * 0.40;
  const colTime = x + width * 0.62;
  const colRoom = x + width * 0.84;

  page.drawLine({
    start: { x: x + 10, y: tableTop + 9 },
    end: { x: right - 10, y: tableTop + 9 },
    thickness: 0.6, color: HAIRLINE,
  });

  for (const [label, cx] of [
    ["Subject", colSubject], ["Date", colDate], ["Time", colTime], ["Room", colRoom],
  ] as [string, number][]) {
    dropped += drawText(page, label, {
      x: cx, y: tableTop, size: 6.5, font: fonts.bold, color: MUTED,
    });
  }

  let rowY = tableTop - 10;
  const shown = card.subjects.slice(0, MAX_SUBJECT_ROWS);

  for (const s of shown) {
    const name = fit(s.subject, fonts.regular, 7.5, colDate - colSubject - 6);
    dropped += name.dropped;
    dropped += drawText(page, name.text, {
      x: colSubject, y: rowY, size: 7.5, font: fonts.regular,
    });
    dropped += drawText(page, prettyDate(s.exam_date).replace(/ \d{4}$/, ""), {
      x: colDate, y: rowY, size: 7.5, font: fonts.regular,
    });
    dropped += drawText(
      page,
      s.starts_at ? `${hhmm(s.starts_at)}–${hhmm(s.ends_at)}` : "—",
      { x: colTime, y: rowY, size: 7.5, font: fonts.regular },
    );
    const room = fit(s.room ?? "—", fonts.regular, 7.5, right - 10 - colRoom);
    dropped += room.dropped;
    dropped += drawText(page, room.text, {
      x: colRoom, y: rowY, size: 7.5, font: fonts.regular,
    });
    rowY -= 10;
  }

  if (card.subjects.length === 0) {
    dropped += drawText(page, "No subjects are configured for this exam yet.", {
      x: colSubject, y: rowY, size: 7, font: fonts.regular, color: BAD,
    });
  } else if (card.subjects.length > MAX_SUBJECT_ROWS) {
    // Said plainly rather than silently dropping rows: a student holding this
    // card must know the list is incomplete.
    dropped += drawText(
      page,
      `+ ${card.subjects.length - MAX_SUBJECT_ROWS} more — see the exam routine`,
      { x: colSubject, y: rowY, size: 6.5, font: fonts.regular, color: BAD },
    );
  }

  // --- override band -----------------------------------------------------
  if (card.overridden) {
    dropped += drawText(page, "Issued by exception — approved by the school administrator", {
      x: x + 10, y: y + 8, size: 6.5, font: fonts.bold, color: BAD,
    });
  }

  return dropped;
}

/**
 * Builds the PDF.
 *
 * Returns the bytes and the dropped-glyph count, so a route can log or surface
 * a coverage problem rather than quietly serving a card full of boxes.
 */
export async function buildAdmitCardPdf(
  input: AdmitCardInput,
): Promise<{ bytes: Uint8Array; dropped: number; pages: number }> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);

  doc.setTitle(`Admit cards — ${input.cards[0]?.exam.name ?? "exam"}`);
  doc.setCreator(input.school.name);

  let dropped = 0;
  const height = cardHeight();
  const width = A4.width - MARGIN * 2;

  const pageCount = Math.max(1, Math.ceil(input.cards.length / PER_PAGE));

  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([A4.width, A4.height]);
    const slice = input.cards.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);

    slice.forEach((card, i) => {
      const y = A4.height - MARGIN - (i + 1) * height - i * CARD_GAP;
      dropped += drawCard(page, fonts, input.school, card, { x: MARGIN, y, width, height });

      // A dashed cut line between cards, not after the last one.
      if (i < slice.length - 1) {
        page.drawLine({
          start: { x: MARGIN, y: y - CARD_GAP / 2 },
          end: { x: A4.width - MARGIN, y: y - CARD_GAP / 2 },
          thickness: 0.5,
          color: HAIRLINE,
          dashArray: [3, 3],
        });
      }
    });

    drawText(page, `Generated ${input.generatedAt}`, {
      x: MARGIN, y: MARGIN - 14, size: 6.5, font: fonts.regular, color: MUTED,
    });
    const label = `Page ${p + 1} of ${pageCount}`;
    drawRight(page, label, {
      x: A4.width - MARGIN, y: MARGIN - 14, size: 6.5,
      font: fonts.regular, color: MUTED,
    });
  }

  return { bytes: await doc.save(), dropped, pages: pageCount };
}

export const ADMIT_CARDS_PER_PAGE = PER_PAGE;
export const ADMIT_CARD_MAX_SUBJECT_ROWS = MAX_SUBJECT_ROWS;
export const admitCardHeight = cardHeight;
