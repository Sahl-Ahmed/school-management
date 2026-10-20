import "server-only";

import {
  ACCENT,
  HAIRLINE,
  HEADER_FILL,
  INK,
  MUTED,
  PDFDocument,
  drawCentred,
  drawText,
  embedFonts,
  fit,
  mm,
  type Fonts,
  type PDFPage,
  type SchoolBranding,
} from "./base";

/**
 * Student ID cards at PVC dimensions, front and back.
 *
 * The page IS the card: 54 × 85.6 mm portrait or 85.6 × 54 mm landscape, which
 * is CR80, the size of a bank card. Printing one of these at "fit to page" on
 * A4 would scale it and the card would not fit a holder, so the route serves it
 * at true size and the office prints at 100%.
 *
 * Which fields appear is NOT decided here. The caller passes the template's
 * declared field list, and anything absent from it is not drawn. That mirrors
 * `issue_qr_token`, which copies the same list into the public QR snapshot — so
 * the printed card and the public page cannot drift apart.
 *
 * The owner chose to print the guardian's phone number on the front, so a
 * finder can call them. The public /card/<token> page deliberately does not
 * render that field, which is why the page shows a subset of the snapshot
 * rather than all of it — see migration 0033 and
 * src/app/card/[token]/page.tsx.
 */

export type IdCardFields = {
  full_name?: string | null;
  full_name_bn?: string | null;
  registration_no?: string | null;
  class_name?: string | null;
  section_name?: string | null;
  roll_no?: number | string | null;
  blood_group?: string | null;
  session?: string | null;
  guardian_phone?: string | null;
};

export type IdCardInput = {
  school: SchoolBranding;
  orientation: "portrait" | "landscape";
  /** The template's field list. A field not named here is not printed. */
  frontFields: string[];
  backFields: string[];
  returnNote: string;
  fields: IdCardFields;
  /** PNG or JPEG bytes of the student photo, when one exists. */
  photo?: Uint8Array | null;
  /** The public card URL, printed on the back for scanning. */
  cardUrl?: string | null;
  /** Rendered QR for cardUrl, as PNG bytes. */
  qr?: Uint8Array | null;
};

/** CR80, the PVC card size, in points. */
export const CARD_PORTRAIT = { width: mm(54), height: mm(85.6) };
export const CARD_LANDSCAPE = { width: mm(85.6), height: mm(54) };

const PAD = 8;

async function drawFront(
  doc: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  input: IdCardInput,
): Promise<number> {
  let dropped = 0;
  const { width, height } = page.getSize();
  const show = (field: string) => input.frontFields.includes(field);

  // Header band with the school name.
  const band = 26;
  page.drawRectangle({
    x: 0, y: height - band, width, height: band, color: HEADER_FILL,
  });
  const name = fit(input.school.short_name || input.school.name, fonts.bold, 9, width - PAD * 2);
  dropped += name.dropped;
  dropped += drawCentred(page, name.text, {
    x: width / 2, y: height - 17, size: 9, font: fonts.bold,
  });

  const landscape = input.orientation === "landscape";

  // --- photo --------------------------------------------------------------
  const photoW = landscape ? 58 : 72;
  const photoH = photoW * 1.25;
  const photoX = landscape ? PAD : (width - photoW) / 2;
  const photoY = height - band - PAD - photoH;

  if (show("photo")) {
    if (input.photo) {
      try {
        // A compressed JPEG is what the admission form produces; PNG is
        // accepted because a re-encoded photo may arrive as either.
        const image = input.photo[0] === 0x89
          ? await doc.embedPng(input.photo)
          : await doc.embedJpg(input.photo);
        page.drawImage(image, { x: photoX, y: photoY, width: photoW, height: photoH });
      } catch {
        // An unreadable photo must not take the whole card down; the frame
        // prints empty and the office can see a photo is missing.
        page.drawRectangle({
          x: photoX, y: photoY, width: photoW, height: photoH,
          borderColor: HAIRLINE, borderWidth: 0.8,
        });
      }
    } else {
      page.drawRectangle({
        x: photoX, y: photoY, width: photoW, height: photoH,
        borderColor: HAIRLINE, borderWidth: 0.8,
      });
      dropped += drawCentred(page, "no photo", {
        x: photoX + photoW / 2, y: photoY + photoH / 2, size: 6,
        font: fonts.regular, color: MUTED,
      });
    }
    page.drawRectangle({
      x: photoX, y: photoY, width: photoW, height: photoH,
      borderColor: HAIRLINE, borderWidth: 0.8,
    });
  }

  // --- the details --------------------------------------------------------
  let cursor: number;
  let textX: number;
  let textWidth: number;

  if (landscape) {
    textX = PAD + photoW + PAD;
    textWidth = width - textX - PAD;
    cursor = height - band - PAD - 10;
  } else {
    textX = PAD;
    textWidth = width - PAD * 2;
    cursor = photoY - 14;
  }

  if (show("full_name") && input.fields.full_name) {
    const v = fit(input.fields.full_name, fonts.bold, landscape ? 8.5 : 10, textWidth);
    dropped += v.dropped;
    dropped += drawText(page, v.text, {
      x: textX, y: cursor, size: landscape ? 8.5 : 10, font: fonts.bold,
    });
    cursor -= landscape ? 10 : 12;
  }

  if (show("full_name_bn") && input.fields.full_name_bn) {
    const v = fit(input.fields.full_name_bn, fonts.regular, 8, textWidth);
    dropped += v.dropped;
    dropped += drawText(page, v.text, {
      x: textX, y: cursor, size: 8, font: fonts.regular, color: MUTED,
    });
    cursor -= 11;
  }

  // Label/value pairs, each omitted when the template does not ask for it.
  const pairs: [string, string, string][] = [
    ["class_name", "Class", [
      input.fields.class_name,
      show("section_name") ? input.fields.section_name : null,
    ].filter(Boolean).join(" — ")],
    ["roll_no", "Roll", input.fields.roll_no != null ? String(input.fields.roll_no) : ""],
    ["registration_no", "Reg. no", input.fields.registration_no ?? ""],
    ["blood_group", "Blood", input.fields.blood_group ?? ""],
    ["session", "Session", input.fields.session ?? ""],
  ];

  for (const [field, label, value] of pairs) {
    if (!show(field) || !value) continue;
    dropped += drawText(page, label, {
      x: textX, y: cursor, size: 5.8, font: fonts.regular, color: MUTED,
    });
    const v = fit(value, fonts.bold, 7.5, textWidth - 32);
    dropped += v.dropped;
    dropped += drawText(page, v.text, {
      x: textX + 32, y: cursor, size: 7.5, font: fonts.bold,
    });
    cursor -= 10;
  }

  // The guardian's number, which the owner chose to print on the front.
  if (show("guardian_phone") && input.fields.guardian_phone) {
    cursor -= 2;
    dropped += drawText(page, "Guardian", {
      x: textX, y: cursor, size: 5.8, font: fonts.regular, color: MUTED,
    });
    const v = fit(input.fields.guardian_phone, fonts.bold, 7.5, textWidth - 32);
    dropped += v.dropped;
    dropped += drawText(page, v.text, {
      x: textX + 32, y: cursor, size: 7.5, font: fonts.bold, color: ACCENT,
    });
  }

  page.drawRectangle({
    x: 0.5, y: 0.5, width: width - 1, height: height - 1,
    borderColor: HAIRLINE, borderWidth: 1,
  });

  return dropped;
}

async function drawBack(
  doc: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  input: IdCardInput,
): Promise<number> {
  let dropped = 0;
  const { width, height } = page.getSize();
  const show = (field: string) => input.backFields.includes(field);

  let cursor = height - PAD - 8;

  dropped += drawCentred(page, input.school.name, {
    x: width / 2, y: cursor, size: 8, font: fonts.bold,
  });
  cursor -= 14;

  if (show("school_address") && input.school.address) {
    const v = fit(input.school.address, fonts.regular, 6.5, width - PAD * 2);
    dropped += v.dropped;
    dropped += drawCentred(page, v.text, {
      x: width / 2, y: cursor, size: 6.5, font: fonts.regular, color: MUTED,
    });
    cursor -= 10;
  }

  // The school's own number, which is the contact route for a found card.
  if (show("office_phone") && input.school.office_phone) {
    dropped += drawCentred(page, `Office: ${input.school.office_phone}`, {
      x: width / 2, y: cursor, size: 7, font: fonts.bold,
    });
    cursor -= 12;
  }

  // --- QR ----------------------------------------------------------------
  const qrSize = Math.min(width - PAD * 4, 74);
  const qrX = (width - qrSize) / 2;
  const qrY = cursor - qrSize - 2;

  if (input.qr) {
    try {
      const image = await doc.embedPng(input.qr);
      page.drawImage(image, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    } catch {
      page.drawRectangle({
        x: qrX, y: qrY, width: qrSize, height: qrSize,
        borderColor: HAIRLINE, borderWidth: 0.8,
      });
    }
  } else {
    page.drawRectangle({
      x: qrX, y: qrY, width: qrSize, height: qrSize,
      borderColor: HAIRLINE, borderWidth: 0.8,
    });
    dropped += drawCentred(page, "no card link issued", {
      x: width / 2, y: qrY + qrSize / 2, size: 5.5, font: fonts.regular, color: MUTED,
    });
  }

  cursor = qrY - 10;
  dropped += drawCentred(page, "Scan to verify this card", {
    x: width / 2, y: cursor, size: 5.8, font: fonts.regular, color: MUTED,
  });
  cursor -= 12;

  if (show("return_note")) {
    // Wrapped by hand: the card is too narrow for a single line and pdf-lib
    // has no paragraph layout.
    const words = input.returnNote.split(" ");
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (fonts.regular.widthOfTextAtSize(candidate, 6) > width - PAD * 2) {
        dropped += drawCentred(page, line, {
          x: width / 2, y: cursor, size: 6, font: fonts.regular, color: INK,
        });
        cursor -= 8;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      dropped += drawCentred(page, line, {
        x: width / 2, y: cursor, size: 6, font: fonts.regular, color: INK,
      });
    }
  }

  page.drawRectangle({
    x: 0.5, y: 0.5, width: width - 1, height: height - 1,
    borderColor: HAIRLINE, borderWidth: 1,
  });

  return dropped;
}

/**
 * Builds a one- or two-page PDF at true card size.
 *
 * `side` selects the front, the back, or both as two pages. Both is the default
 * because a double-sided print needs them in one file.
 */
export async function buildIdCardPdf(
  input: IdCardInput,
  side: "front" | "back" | "both" = "both",
): Promise<{ bytes: Uint8Array; dropped: number }> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);

  doc.setTitle(`ID card — ${input.fields.full_name ?? input.fields.registration_no ?? "student"}`);
  doc.setCreator(input.school.name);

  const size = input.orientation === "landscape" ? CARD_LANDSCAPE : CARD_PORTRAIT;
  let dropped = 0;

  if (side === "front" || side === "both") {
    dropped += await drawFront(doc, doc.addPage([size.width, size.height]), fonts, input);
  }
  if (side === "back" || side === "both") {
    dropped += await drawBack(doc, doc.addPage([size.width, size.height]), fonts, input);
  }

  return { bytes: await doc.save(), dropped };
}
