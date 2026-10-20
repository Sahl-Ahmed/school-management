import "server-only";

/**
 * Printable cash receipt.
 *
 * Laid out as a HALF of an A4 sheet rather than a full page: school offices
 * print these in volume, often two to a sheet and cut, and a full A4 page per
 * receipt wastes paper the school pays for. The page is still A4 so it feeds a
 * normal tray; the second half carries an identical copy marked "office copy",
 * which is what a cash book needs.
 *
 * Everything printed comes from receipts.snapshot, frozen when the payment was
 * recorded. A reprint therefore matches the paper the guardian already holds,
 * even if a fee rate or the student's class changed afterwards.
 *
 * The fonts, the regeneratorRuntime polyfill and the text helpers live in
 * ./base, shared with every other generator here.
 */

import {
  A4,
  ACCENT,
  HAIRLINE,
  INK,
  MARGIN,
  MUTED,
  PDFDocument,
  embedFonts,
  rgb,
  type Fonts,
  type PDFPage,
} from "./base";

export type ReceiptSnapshot = {
  student?: {
    full_name?: string;
    registration_no?: string;
    class_name?: string | null;
    section_name?: string | null;
    roll_no?: number | null;
  };
  payment?: {
    amount?: number | string;
    method?: string;
    reference_no?: string | null;
    allocated?: number | string;
    unallocated?: number | string;
  };
  items?: {
    fee_type?: string;
    period_year?: number | null;
    period_month?: number | null;
    exam?: string | null;
    amount?: number | string;
  }[];
};

export type ReceiptInput = {
  receiptNo: string;
  issuedAt: string;
  paidAt: string;
  reversedAt: string | null;
  snapshot: ReceiptSnapshot;
  school: {
    name: string;
    address: string | null;
    office_phone: string | null;
    email: string | null;
  };
  receivedBy: string | null;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function period(item: NonNullable<ReceiptSnapshot["items"]>[number]): string {
  if (item.exam) return item.exam;
  if (item.period_year && item.period_month) {
    return `${MONTHS[item.period_month - 1]} ${item.period_year}`;
  }
  return "One-off";
}

/** ৳ is drawn from the embedded font, which covers it; Latin fonts do not. */
function money(amount: number | string | null | undefined): string {
  const value = Number(amount ?? 0);
  const whole = Number.isInteger(value);
  return `৳${value.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Draws one receipt into the given vertical band.
 *
 * `top` is the y of the band's upper edge, so the same routine renders the
 * guardian copy and the office copy without duplicated layout code.
 */
function drawReceipt(
  page: PDFPage,
  fonts: Fonts,
  input: ReceiptInput,
  top: number,
  height: number,
  copyLabel: string,
): void {
  const left = MARGIN;
  const right = A4.width - MARGIN;
  let y = top - 18;

  page.drawText(input.school.name, {
    x: left, y, size: 13, font: fonts.bold, color: INK,
  });

  const copyWidth = fonts.regular.widthOfTextAtSize(copyLabel, 8);
  page.drawText(copyLabel, {
    x: right - copyWidth, y: y + 2, size: 8, font: fonts.regular, color: MUTED,
  });

  y -= 12;
  const contact = [input.school.address, input.school.office_phone, input.school.email]
    .filter(Boolean)
    .join("  ·  ");
  if (contact) {
    page.drawText(contact, {
      x: left, y, size: 7, font: fonts.regular, color: MUTED,
    });
  }

  y -= 18;
  page.drawText("FEE RECEIPT", {
    x: left, y, size: 10, font: fonts.bold, color: ACCENT,
  });

  const noLabel = `No. ${input.receiptNo}`;
  const noWidth = fonts.bold.widthOfTextAtSize(noLabel, 10);
  page.drawText(noLabel, {
    x: right - noWidth, y, size: 10, font: fonts.bold, color: INK,
  });

  y -= 6;
  page.drawLine({
    start: { x: left, y }, end: { x: right, y }, thickness: 1, color: INK,
  });

  // A reversed payment must say so on its face. Reprinting a reversed receipt
  // without this would hand someone proof of a payment the school has undone.
  if (input.reversedAt) {
    y -= 14;
    page.drawText(
      `REVERSED on ${input.reversedAt.slice(0, 10)} — this payment has been cancelled`,
      { x: left, y, size: 9, font: fonts.bold, color: rgb(0.65, 0.12, 0.12) },
    );
  }

  // --- student and payment details, two columns ---
  y -= 18;
  const s = input.snapshot.student ?? {};
  const colTwo = left + (right - left) / 2;

  const rows: [string, string][] = [
    ["Student", s.full_name ?? "—"],
    ["Registration", s.registration_no ?? "—"],
    [
      "Class",
      `${s.class_name ?? "—"}${s.section_name ? ` — ${s.section_name}` : ""}${s.roll_no ? `, roll ${s.roll_no}` : ""}`,
    ],
  ];

  const rightRows: [string, string][] = [
    ["Date", input.paidAt.slice(0, 10)],
    ["Method", input.snapshot.payment?.method ?? "cash"],
    ["Reference", input.snapshot.payment?.reference_no || "—"],
  ];

  rows.forEach(([label, value], i) => {
    const ry = y - i * 12;
    page.drawText(`${label}:`, { x: left, y: ry, size: 8, font: fonts.regular, color: MUTED });
    page.drawText(value, { x: left + 56, y: ry, size: 8, font: fonts.bold, color: INK });
  });

  rightRows.forEach(([label, value], i) => {
    const ry = y - i * 12;
    page.drawText(`${label}:`, { x: colTwo, y: ry, size: 8, font: fonts.regular, color: MUTED });
    page.drawText(value, { x: colTwo + 52, y: ry, size: 8, font: fonts.bold, color: INK });
  });

  y -= 3 * 12 + 10;

  // --- itemised lines ---
  page.drawLine({
    start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: HAIRLINE,
  });
  y -= 11;
  page.drawText("Period", { x: left, y, size: 7.5, font: fonts.bold, color: MUTED });
  page.drawText("Fee", { x: left + 150, y, size: 7.5, font: fonts.bold, color: MUTED });
  const amtHeader = "Amount";
  page.drawText(amtHeader, {
    x: right - fonts.bold.widthOfTextAtSize(amtHeader, 7.5),
    y, size: 7.5, font: fonts.bold, color: MUTED,
  });
  y -= 4;
  page.drawLine({
    start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: HAIRLINE,
  });

  const items = input.snapshot.items ?? [];
  for (const item of items) {
    y -= 12;
    page.drawText(period(item), { x: left, y, size: 8, font: fonts.regular, color: INK });
    page.drawText(item.fee_type ?? "—", {
      x: left + 150, y, size: 8, font: fonts.regular, color: INK,
    });
    const amt = money(item.amount);
    page.drawText(amt, {
      x: right - fonts.regular.widthOfTextAtSize(amt, 8),
      y, size: 8, font: fonts.regular, color: INK,
    });
  }

  if (items.length === 0) {
    y -= 12;
    page.drawText("Payment not allocated to a specific charge", {
      x: left, y, size: 8, font: fonts.regular, color: MUTED,
    });
  }

  // --- total ---
  y -= 8;
  page.drawLine({
    start: { x: left, y }, end: { x: right, y }, thickness: 1, color: INK,
  });
  y -= 14;

  const total = money(input.snapshot.payment?.amount);
  page.drawText("Total received", { x: left, y, size: 9.5, font: fonts.bold, color: INK });
  page.drawText(total, {
    x: right - fonts.bold.widthOfTextAtSize(total, 11),
    y: y - 1, size: 11, font: fonts.bold, color: ACCENT,
  });

  const unallocated = Number(input.snapshot.payment?.unallocated ?? 0);
  if (unallocated > 0) {
    y -= 12;
    page.drawText(
      `${money(unallocated)} of this is unallocated and remains as credit.`,
      { x: left, y, size: 7.5, font: fonts.regular, color: MUTED },
    );
  }

  // --- signature ---
  const sigY = top - height + 26;
  page.drawLine({
    start: { x: right - 150, y: sigY + 10 }, end: { x: right, y: sigY + 10 },
    thickness: 0.5, color: HAIRLINE,
  });
  page.drawText("Received by", {
    x: right - 150, y: sigY, size: 7, font: fonts.regular, color: MUTED,
  });
  if (input.receivedBy) {
    page.drawText(input.receivedBy, {
      x: right - 150, y: sigY + 14, size: 7.5, font: fonts.regular, color: INK,
    });
  }

  page.drawText(
    `Issued ${input.issuedAt.slice(0, 10)} · computer generated`,
    { x: left, y: sigY, size: 7, font: fonts.regular, color: MUTED },
  );
}

/**
 * One A4 page carrying two identical copies: guardian above, office below,
 * separated by a cut line.
 */
export async function buildReceiptPdf(input: ReceiptInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);

  const page = doc.addPage([A4.width, A4.height]);
  const half = (A4.height - MARGIN) / 2;

  drawReceipt(page, fonts, input, A4.height - MARGIN, half - MARGIN, "Guardian copy");

  // The cut line, dashed so it reads as "cut here" rather than a table rule.
  const midY = A4.height / 2;
  page.drawLine({
    start: { x: MARGIN, y: midY }, end: { x: A4.width - MARGIN, y: midY },
    thickness: 0.5, color: HAIRLINE, dashArray: [4, 3],
  });

  drawReceipt(page, fonts, input, midY - 12, half - MARGIN, "Office copy");

  doc.setTitle(`Fee Receipt ${input.receiptNo}`);
  doc.setAuthor(input.school.name);
  doc.setCreator("School Management");

  return doc.save();
}

export const RECEIPT_A4 = A4;
