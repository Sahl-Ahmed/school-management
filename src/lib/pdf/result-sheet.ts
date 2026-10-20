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
  drawFooter,
  drawRight,
  drawText,
  embedFonts,
  fit,
  prettyDate,
  type Fonts,
  type PDFPage,
  type SchoolBranding,
} from "./base";

/**
 * Result sheets, one A4 page per student.
 *
 * Every figure comes from the published snapshot, never recomputed here. That
 * is what makes a reprint months later identical to the sheet the parent first
 * received, even if a mark was corrected in between — and it is why this file
 * does no arithmetic beyond laying out what it is given.
 *
 * Where the printed GPA and grade differ from what the marks alone would give,
 * the sheet says so in words. A parent handed "GPA 0.00" beside an average of
 * 54% is owed the reason, and a footnote is cheaper than a phone call to the
 * office.
 */

export type ResultSubject = {
  subject: string;
  obtained: number | null;
  max: number;
  pass_marks: number;
  percentage: number;
  grade: string | null;
  grade_point: number;
  absent: boolean;
  passed: boolean;
};

export type ResultSnapshot = {
  subjects: ResultSubject[];
  gpa_computed: number;
  gpa_printed: number | null;
  grade_computed?: string | null;
  failed_subjects: number;
  pass_rule: string;
  scale: string;
  attendance: {
    present: number;
    submitted_lessons: number;
    window_start: string | null;
    window_end: string | null;
  };
};

export type ResultSheet = {
  full_name: string;
  full_name_bn: string | null;
  registration_no: string;
  roll_no: number;
  class_name: string;
  section_name: string | null;
  father_name: string;
  mother_name: string;
  total_obtained: number | string;
  total_max: number | string;
  percentage: number | string;
  gpa: number | string | null;
  grade: string | null;
  is_pass: boolean;
  attendance_pct: number | string | null;
  position_in_class: number | null;
  snapshot: ResultSnapshot;
};

export type ResultSheetInput = {
  school: SchoolBranding;
  exam: {
    name: string;
    term_name: string;
    academic_year: string;
    results_published_at: string | null;
  };
  sheets: ResultSheet[];
  generatedAt: string;
};

const num = (v: number | string | null | undefined): number =>
  v === null || v === undefined ? 0 : Number(v);

function drawSheet(
  page: PDFPage,
  fonts: Fonts,
  input: ResultSheetInput,
  sheet: ResultSheet,
): number {
  let dropped = 0;

  // --- header -------------------------------------------------------------
  let y = A4.height - MARGIN;

  dropped += drawCentred(page, input.school.name, {
    x: A4.width / 2, y: y - 16, size: 16, font: fonts.bold,
  });

  const contact = [input.school.address, input.school.office_phone]
    .filter(Boolean)
    .join("  ·  ");
  if (contact) {
    dropped += drawCentred(page, contact, {
      x: A4.width / 2, y: y - 29, size: 7.5, font: fonts.regular, color: MUTED,
    });
  }

  dropped += drawCentred(page, "ACADEMIC TRANSCRIPT", {
    x: A4.width / 2, y: y - 48, size: 10, font: fonts.bold, color: ACCENT,
  });
  dropped += drawCentred(
    page,
    `${input.exam.name}  ·  ${input.exam.term_name}  ·  ${input.exam.academic_year}`,
    { x: A4.width / 2, y: y - 61, size: 8.5, font: fonts.regular, color: MUTED },
  );

  y -= 74;
  page.drawLine({
    start: { x: MARGIN, y }, end: { x: A4.width - MARGIN, y },
    thickness: 1, color: INK,
  });
  y -= 18;

  // --- student block, two columns ----------------------------------------
  const leftLabel = MARGIN;
  const leftValue = MARGIN + 74;
  const rightLabel = A4.width / 2 + 10;
  const rightValue = A4.width / 2 + 84;

  const left: [string, string][] = [
    ["Name", sheet.full_name],
    ["Class", `${sheet.class_name}${sheet.section_name ? ` — ${sheet.section_name}` : ""}`],
    ["Roll", String(sheet.roll_no)],
  ];
  const right: [string, string][] = [
    ["Registration", sheet.registration_no],
    ["Father", sheet.father_name],
    ["Mother", sheet.mother_name],
  ];

  let rowY = y;
  for (let i = 0; i < 3; i++) {
    for (const [pairs, lx, vx, w] of [
      [left, leftLabel, leftValue, A4.width / 2 - leftValue - 10],
      [right, rightLabel, rightValue, A4.width - MARGIN - rightValue],
    ] as [[string, string][], number, number, number][]) {
      const pair = pairs[i];
      if (!pair) continue;
      dropped += drawText(page, pair[0], {
        x: lx, y: rowY, size: 7.5, font: fonts.regular, color: MUTED,
      });
      const v = fit(pair[1], fonts.bold, 9, w);
      dropped += v.dropped;
      dropped += drawText(page, v.text, { x: vx, y: rowY, size: 9, font: fonts.bold });
    }
    rowY -= 13;
  }

  if (sheet.full_name_bn) {
    const bn = fit(sheet.full_name_bn, fonts.regular, 9, A4.width / 2 - leftValue - 10);
    dropped += bn.dropped;
    dropped += drawText(page, bn.text, {
      x: leftValue, y: rowY, size: 9, font: fonts.regular, color: MUTED,
    });
    rowY -= 13;
  }

  y = rowY - 8;

  // --- subject table ------------------------------------------------------
  const cols = {
    subject: MARGIN,
    obtained: A4.width - MARGIN - 260,
    max: A4.width - MARGIN - 205,
    pass: A4.width - MARGIN - 150,
    pct: A4.width - MARGIN - 95,
    grade: A4.width - MARGIN - 48,
    point: A4.width - MARGIN,
  };

  page.drawRectangle({
    x: MARGIN, y: y - 16, width: A4.width - MARGIN * 2, height: 18,
    color: HEADER_FILL,
  });
  dropped += drawText(page, "Subject", {
    x: cols.subject + 4, y: y - 11, size: 8, font: fonts.bold,
  });
  for (const [label, x] of [
    ["Marks", cols.obtained], ["Out of", cols.max], ["Pass", cols.pass],
    ["%", cols.pct], ["Grade", cols.grade],
  ] as [string, number][]) {
    dropped += drawRight(page, label, { x: x + 44, y: y - 11, size: 8, font: fonts.bold });
  }
  dropped += drawRight(page, "Point", {
    x: cols.point, y: y - 11, size: 8, font: fonts.bold,
  });
  y -= 22;

  for (const s of sheet.snapshot.subjects) {
    const name = fit(s.subject, fonts.regular, 9, cols.obtained - cols.subject - 10);
    dropped += name.dropped;
    dropped += drawText(page, name.text, {
      x: cols.subject + 4, y, size: 9, font: fonts.regular,
    });

    dropped += drawRight(page, s.absent ? "absent" : String(s.obtained ?? "—"), {
      x: cols.obtained + 44, y, size: 9,
      font: fonts.regular,
      color: s.absent ? MUTED : INK,
    });
    dropped += drawRight(page, String(s.max), {
      x: cols.max + 44, y, size: 9, font: fonts.regular,
    });
    dropped += drawRight(page, String(s.pass_marks), {
      x: cols.pass + 44, y, size: 9, font: fonts.regular, color: MUTED,
    });
    dropped += drawRight(page, `${s.percentage}`, {
      x: cols.pct + 44, y, size: 9, font: fonts.regular,
    });
    dropped += drawRight(page, s.grade ?? "—", {
      x: cols.grade + 44, y, size: 9, font: fonts.bold,
      color: s.passed ? INK : BAD,
    });
    dropped += drawRight(page, s.grade_point.toFixed(2), {
      x: cols.point, y, size: 9, font: fonts.regular,
    });

    y -= 14;
    page.drawLine({
      start: { x: MARGIN, y: y + 4 }, end: { x: A4.width - MARGIN, y: y + 4 },
      thickness: 0.4, color: HAIRLINE,
    });
  }

  // --- totals row ---------------------------------------------------------
  y -= 4;
  page.drawLine({
    start: { x: MARGIN, y: y + 8 }, end: { x: A4.width - MARGIN, y: y + 8 },
    thickness: 1, color: INK,
  });
  dropped += drawText(page, "Total", {
    x: cols.subject + 4, y, size: 9.5, font: fonts.bold,
  });
  dropped += drawRight(page, String(num(sheet.total_obtained)), {
    x: cols.obtained + 44, y, size: 9.5, font: fonts.bold,
  });
  dropped += drawRight(page, String(num(sheet.total_max)), {
    x: cols.max + 44, y, size: 9.5, font: fonts.bold,
  });
  dropped += drawRight(page, `${num(sheet.percentage)}`, {
    x: cols.pct + 44, y, size: 9.5, font: fonts.bold,
  });
  dropped += drawRight(page, sheet.grade ?? "—", {
    x: cols.grade + 44, y, size: 9.5, font: fonts.bold,
    color: sheet.is_pass ? INK : BAD,
  });
  dropped += drawRight(page, sheet.gpa === null ? "—" : num(sheet.gpa).toFixed(2), {
    x: cols.point, y, size: 9.5, font: fonts.bold,
  });

  y -= 30;

  // --- summary boxes ------------------------------------------------------
  const boxWidth = (A4.width - MARGIN * 2 - 18) / 4;
  const boxes: [string, string, string][] = [
    ["Result", sheet.is_pass ? "PASSED" : "NOT PASSED", ""],
    ["GPA", sheet.gpa === null ? "—" : num(sheet.gpa).toFixed(2), sheet.snapshot.scale],
    ["Grade", sheet.grade ?? "—", `${num(sheet.percentage)}% overall`],
    [
      "Position",
      sheet.position_in_class ? `${sheet.position_in_class}` : "—",
      sheet.position_in_class ? "in the section" : "not ranked",
    ],
  ];

  boxes.forEach(([label, value, detail], i) => {
    const bx = MARGIN + i * (boxWidth + 6);
    page.drawRectangle({
      x: bx, y: y - 40, width: boxWidth, height: 44,
      borderColor: HAIRLINE, borderWidth: 0.8,
    });
    dropped += drawText(page, label, {
      x: bx + 6, y: y - 10, size: 7, font: fonts.regular, color: MUTED,
    });
    dropped += drawText(page, value, {
      x: bx + 6, y: y - 26, size: 13, font: fonts.bold,
      color: label === "Result" && !sheet.is_pass ? BAD : INK,
    });
    if (detail) {
      const d = fit(detail, fonts.regular, 6.5, boxWidth - 12);
      dropped += d.dropped;
      dropped += drawText(page, d.text, {
        x: bx + 6, y: y - 36, size: 6.5, font: fonts.regular, color: MUTED,
      });
    }
  });

  y -= 56;

  // --- attendance ---------------------------------------------------------
  const att = sheet.snapshot.attendance;
  if (att && att.submitted_lessons > 0) {
    dropped += drawText(
      page,
      `Attendance this term: ${att.present} of ${att.submitted_lessons} submitted lessons` +
        ` (${num(sheet.attendance_pct)}%)` +
        (att.window_start ? `, ${prettyDate(att.window_start)} to ${prettyDate(att.window_end)}` : ""),
      { x: MARGIN, y, size: 8, font: fonts.regular },
    );
    y -= 11;
    dropped += drawText(
      page,
      "Counted only from lessons a teacher submitted. A lesson with no submission is not counted against the student.",
      { x: MARGIN, y, size: 6.5, font: fonts.regular, color: MUTED },
    );
    y -= 14;
  } else {
    dropped += drawText(
      page,
      att && !att.window_start
        ? "No attendance figure is printed: this term has no attendance window configured."
        : "No attendance figure is printed: no attendance was submitted in this term's window.",
      { x: MARGIN, y, size: 8, font: fonts.regular, color: MUTED },
    );
    y -= 14;
  }

  // --- the footnote that explains a zeroed GPA ---------------------------
  const snap = sheet.snapshot;
  if (
    !sheet.is_pass &&
    sheet.gpa !== null &&
    num(sheet.gpa) === 0 &&
    snap.gpa_computed > 0
  ) {
    const band = snap.grade_computed ? ` and sat in the ${snap.grade_computed} band` : "";
    dropped += drawText(
      page,
      `GPA prints as 0.00 and the grade as ${sheet.grade} because ` +
        `${snap.failed_subjects === 1 ? "one subject was" : `${snap.failed_subjects} subjects were`}` +
        ` below the pass mark. The school's rule is that every subject must be passed.`,
      { x: MARGIN, y, size: 7, font: fonts.regular, color: INK },
    );
    y -= 10;
    dropped += drawText(
      page,
      `On the marks alone this term would have averaged ${snap.gpa_computed.toFixed(2)}${band}.`,
      { x: MARGIN, y, size: 7, font: fonts.regular, color: MUTED },
    );
    y -= 14;
  }

  // --- signature ---------------------------------------------------------
  const sigY = MARGIN + 36;
  page.drawLine({
    start: { x: A4.width - MARGIN - 150, y: sigY },
    end: { x: A4.width - MARGIN, y: sigY },
    thickness: 0.6, color: INK,
  });
  dropped += drawCentred(page, "Head teacher", {
    x: A4.width - MARGIN - 75, y: sigY - 10, size: 7.5, font: fonts.regular, color: MUTED,
  });

  if (input.exam.results_published_at) {
    dropped += drawText(
      page,
      `Published ${prettyDate(input.exam.results_published_at.slice(0, 10))}`,
      { x: MARGIN, y: sigY, size: 7, font: fonts.regular, color: MUTED },
    );
  }

  return dropped;
}

export async function buildResultSheetPdf(
  input: ResultSheetInput,
): Promise<{ bytes: Uint8Array; dropped: number; pages: number }> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);

  doc.setTitle(`${input.exam.name} — result sheets`);
  doc.setCreator(input.school.name);

  let dropped = 0;

  if (input.sheets.length === 0) {
    const page = doc.addPage([A4.width, A4.height]);
    const header = drawHeaderFallback(page, fonts, input);
    dropped += header;
  }

  for (const sheet of input.sheets) {
    const page = doc.addPage([A4.width, A4.height]);
    dropped += drawSheet(page, fonts, input, sheet);
  }

  const pages = doc.getPageCount();
  doc.getPages().forEach((p, i) => drawFooter(p, fonts, input.generatedAt, i + 1, pages));

  return { bytes: await doc.save(), dropped, pages };
}

/** A single page saying there is nothing to print, rather than an empty PDF. */
function drawHeaderFallback(
  page: PDFPage,
  fonts: Fonts,
  input: ResultSheetInput,
): number {
  let dropped = 0;
  dropped += drawCentred(page, input.school.name, {
    x: A4.width / 2, y: A4.height - MARGIN - 16, size: 16, font: fonts.bold,
  });
  dropped += drawCentred(
    page,
    "No published results match this request.",
    { x: A4.width / 2, y: A4.height / 2, size: 11, font: fonts.regular, color: MUTED },
  );
  return dropped;
}
