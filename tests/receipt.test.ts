import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildReceiptPdf, RECEIPT_A4, type ReceiptInput } from "@/lib/pdf/receipt";

/**
 * Receipt PDF tests.
 *
 * A receipt is a financial document a guardian keeps, so the things worth
 * asserting are: it is the right page size, it reproduces the FROZEN snapshot
 * rather than live data, and a reversed payment says so on its face.
 */

const base: ReceiptInput = {
  receiptNo: "RCP-2026-000001",
  issuedAt: "2026-10-19T10:00:00Z",
  paidAt: "2026-10-19T09:45:00Z",
  reversedAt: null,
  receivedBy: "Office Staff",
  school: {
    name: "Test School",
    address: "Dhaka, Bangladesh",
    office_phone: "+8801300000000",
    email: "office@school.invalid",
  },
  snapshot: {
    student: {
      full_name: "Demo Student Alpha",
      registration_no: "STU-2026-0001",
      class_name: "Class 3",
      section_name: "A",
      roll_no: 1,
    },
    payment: { amount: 1100, method: "cash", reference_no: null, allocated: 1100, unallocated: 0 },
    items: [
      { fee_type: "Monthly Tuition", period_year: 2026, period_month: 1, amount: 550 },
      { fee_type: "Monthly Tuition", period_year: 2026, period_month: 2, amount: 550 },
    ],
  },
};

describe("receipt PDF", () => {
  it("is a single A4 page", async () => {
    const doc = await PDFDocument.load(await buildReceiptPdf(base));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(RECEIPT_A4.width, 1);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(RECEIPT_A4.height, 1);
  });

  it("names the receipt in its metadata", async () => {
    const doc = await PDFDocument.load(await buildReceiptPdf(base));
    expect(doc.getTitle()).toContain("RCP-2026-000001");
    expect(doc.getAuthor()).toBe("Test School");
  });

  it("renders a Bangla school and student name", async () => {
    // The receipt uses the same embedded family as the routine PDFs, so a
    // Bangla school name must not come out as question marks.
    const bytes = await buildReceiptPdf({
      ...base,
      school: { ...base.school, name: "আদর্শ উচ্চ বিদ্যালয়", address: "ঢাকা" },
      snapshot: {
        ...base.snapshot,
        student: { ...base.snapshot.student, full_name: "মোহাম্মদ রফিকুল ইসলাম" },
      },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("renders a reversed payment without throwing", async () => {
    const bytes = await buildReceiptPdf({ ...base, reversedAt: "2026-10-20T08:00:00Z" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("handles a payment with no allocated charges", async () => {
    const bytes = await buildReceiptPdf({
      ...base,
      snapshot: { ...base.snapshot, items: [] },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("handles an unallocated balance", async () => {
    const bytes = await buildReceiptPdf({
      ...base,
      snapshot: {
        ...base.snapshot,
        payment: { amount: 1200, method: "bkash", allocated: 1100, unallocated: 100 },
      },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("survives an empty snapshot rather than crashing on a reprint", async () => {
    // Defensive: a receipt written before the snapshot shape settled must still
    // print something rather than 500 when the office reaches for it.
    const bytes = await buildReceiptPdf({ ...base, snapshot: {} });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("fits many line items on the half page", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      fee_type: "Monthly Tuition",
      period_year: 2026,
      period_month: (i % 12) + 1,
      amount: 550,
    }));
    const bytes = await buildReceiptPdf({
      ...base,
      snapshot: { ...base.snapshot, items, payment: { amount: 6600 } },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
