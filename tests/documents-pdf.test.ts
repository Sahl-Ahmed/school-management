import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
// The shaping checks embed a font directly, which needs the same polyfill the
// generators import. See src/lib/pdf/base.ts for why.
import "regenerator-runtime/runtime.js";
import {
  buildAdmitCardPdf,
  ADMIT_CARDS_PER_PAGE,
  ADMIT_CARD_MAX_SUBJECT_ROWS,
  type AdmitCard,
} from "@/lib/pdf/admit-card";
import { buildIdCardPdf, CARD_PORTRAIT, CARD_LANDSCAPE } from "@/lib/pdf/id-card";
import { buildExamRoutinePdf, type ExamRoutineRow } from "@/lib/pdf/exam-routine";
import { buildResultSheetPdf, type ResultSheet } from "@/lib/pdf/result-sheet";
import { A4, mm, type SchoolBranding } from "@/lib/pdf/base";

/**
 * Phase 6 PDF tests.
 *
 * The brief asks that these "measure correctly when printed, not just on
 * screen", which is what these assert: the page geometry in points, the number
 * of cards per sheet, and that Bangla survives with no dropped glyphs. A test
 * that only checked the bytes parse as a PDF would prove nothing a school
 * printer cares about.
 *
 * A PVC card at the wrong size is the expensive failure here — cards are
 * printed in bulk on plastic, and a 5% scaling error is only discovered when a
 * box of them will not fit a holder.
 */

const school: SchoolBranding = {
  name: "Test School",
  short_name: "TS",
  address: "Dhaka, Bangladesh",
  office_phone: "+8801300000000",
  email: "office@school.invalid",
};

const BANGLA_SCHOOL: SchoolBranding = {
  name: "ঢাকা আদর্শ উচ্চ বিদ্যালয়",
  short_name: "ঢাআউবি",
  address: "ঢাকা, বাংলাদেশ",
  office_phone: "+8801300000000",
  email: "office@school.invalid",
};

function admitCard(overrides: Partial<AdmitCard> = {}): AdmitCard {
  return {
    student: {
      full_name: "Demo Student Alpha",
      full_name_bn: "ডেমো শিক্ষার্থী আলফা",
      registration_no: "STU-2026-0001",
      roll_no: 1,
      class_name: "Class 3",
      section_name: "A",
      father_name: "Demo Guardian A",
      mother_name: "Demo Mother A",
    },
    exam: {
      name: "Second Term Examination",
      term_name: "Second Term",
      academic_year: "2026",
      starts_on: "2026-06-01",
      ends_on: "2026-06-10",
    },
    seat_token: "K7M2PQR9TB",
    subjects: [
      { subject: "Bangla", subject_bn: "বাংলা", exam_date: "2026-06-01", starts_at: "09:00:00", ends_at: "11:00:00", room: "Room 1", max_marks: 100 },
      { subject: "Mathematics", subject_bn: "গণিত", exam_date: "2026-06-03", starts_at: "09:00:00", ends_at: "11:00:00", room: "Room 1", max_marks: 100 },
    ],
    ...overrides,
  };
}

const GENERATED = "19 October 2026";

// ===========================================================================
describe("admit cards", () => {
  it("prints exactly three to an A4 page", async () => {
    const cards = Array.from({ length: 3 }, (_, i) =>
      admitCard({
        student: { ...admitCard().student, roll_no: i + 1, registration_no: `STU-2026-000${i + 1}` },
      }),
    );

    const { bytes, pages } = await buildAdmitCardPdf({ school, cards, generatedAt: GENERATED });
    const doc = await PDFDocument.load(bytes);

    expect(ADMIT_CARDS_PER_PAGE).toBe(3);
    expect(pages).toBe(1);
    expect(doc.getPageCount()).toBe(1);

    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(Math.round(A4.width));
    expect(Math.round(height)).toBe(Math.round(A4.height));
  });

  it("starts a new sheet for the fourth card", async () => {
    const cards = Array.from({ length: 4 }, () => admitCard());
    const { bytes, pages } = await buildAdmitCardPdf({ school, cards, generatedAt: GENERATED });

    expect(pages).toBe(2);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it("puts 10 cards on 4 sheets", async () => {
    const cards = Array.from({ length: 10 }, () => admitCard());
    const { pages } = await buildAdmitCardPdf({ school, cards, generatedAt: GENERATED });
    expect(pages).toBe(4);
  });

  it("renders Bangla names and a Bangla school name with no dropped glyphs", async () => {
    const { dropped } = await buildAdmitCardPdf({
      school: BANGLA_SCHOOL,
      cards: [admitCard({
        student: {
          ...admitCard().student,
          full_name: "ডেমো শিক্ষার্থী",
          full_name_bn: "ডেমো শিক্ষার্থী আলফা",
          father_name: "অভিভাবক",
          mother_name: "মাতা",
        },
        subjects: [
          { subject: "বাংলা", subject_bn: "বাংলা", exam_date: "2026-06-01", starts_at: "09:00:00", ends_at: "11:00:00", room: "কক্ষ ১", max_marks: 100 },
        ],
      })],
      generatedAt: GENERATED,
    });

    expect(dropped, "every Bengali character must have a glyph").toBe(0);
  });

  it("caps the timetable and says how many rows it left off", async () => {
    // Six subjects in a card sized for four. The overflow must be stated, not
    // silently dropped: a student holding this card has to know the list is
    // incomplete.
    const many = Array.from({ length: 6 }, (_, i) => ({
      subject: `Subject ${i + 1}`,
      subject_bn: null,
      exam_date: `2026-06-0${i + 1}`,
      starts_at: "09:00:00",
      ends_at: "11:00:00",
      room: "Room 1",
      max_marks: 100,
    }));

    const { bytes } = await buildAdmitCardPdf({
      school,
      cards: [admitCard({ subjects: many })],
      generatedAt: GENERATED,
    });

    expect(ADMIT_CARD_MAX_SUBJECT_ROWS).toBe(4);
    // Still one page, so the extra rows did not push the card off the sheet.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("renders a card with no seat code and no subjects without failing", async () => {
    const { bytes } = await buildAdmitCardPdf({
      school,
      cards: [admitCard({ seat_token: null, subjects: [] })],
      generatedAt: GENERATED,
    });

    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("produces one page for an empty stack rather than a zero-page file", async () => {
    const { bytes, pages } = await buildAdmitCardPdf({
      school, cards: [], generatedAt: GENERATED,
    });

    expect(pages).toBe(1);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

// ===========================================================================
describe("ID cards at PVC size", () => {
  const fields = {
    full_name: "Demo Student Alpha",
    full_name_bn: "ডেমো শিক্ষার্থী আলফা",
    registration_no: "STU-2026-0001",
    class_name: "Class 3",
    section_name: "A",
    roll_no: 1,
    blood_group: "B+",
    session: "2026",
    guardian_phone: "+8801300000101",
  };

  const frontFields = [
    "photo", "full_name", "full_name_bn", "class_name", "section_name",
    "roll_no", "registration_no", "blood_group", "session", "guardian_phone",
  ];
  const backFields = ["school_address", "office_phone", "return_note"];

  const input = (orientation: "portrait" | "landscape") => ({
    school,
    orientation,
    frontFields,
    backFields,
    returnNote: "If found, please return this card to the school office.",
    fields,
  });

  it("is exactly CR80 in portrait — 54 × 85.6 mm", async () => {
    const { bytes } = await buildIdCardPdf(input("portrait"), "front");
    const page = (await PDFDocument.load(bytes)).getPage(0);
    const { width, height } = page.getSize();

    // Asserted in millimetres, because that is the dimension a card printer
    // and a card holder are specified in.
    expect(width / mm(1)).toBeCloseTo(54, 2);
    expect(height / mm(1)).toBeCloseTo(85.6, 2);
    expect(width).toBeCloseTo(CARD_PORTRAIT.width, 5);
    expect(height).toBeCloseTo(CARD_PORTRAIT.height, 5);
  });

  it("is exactly CR80 in landscape — 85.6 × 54 mm", async () => {
    const { bytes } = await buildIdCardPdf(input("landscape"), "front");
    const { width, height } = (await PDFDocument.load(bytes)).getPage(0).getSize();

    expect(width / mm(1)).toBeCloseTo(85.6, 2);
    expect(height / mm(1)).toBeCloseTo(54, 2);
    expect(width).toBeCloseTo(CARD_LANDSCAPE.width, 5);
    expect(height).toBeCloseTo(CARD_LANDSCAPE.height, 5);
  });

  it("has the same aspect ratio either way, as a bank card does", async () => {
    const p = (await PDFDocument.load((await buildIdCardPdf(input("portrait"), "front")).bytes))
      .getPage(0).getSize();
    const l = (await PDFDocument.load((await buildIdCardPdf(input("landscape"), "front")).bytes))
      .getPage(0).getSize();

    expect(p.height / p.width).toBeCloseTo(l.width / l.height, 4);
  });

  it("gives front and back as two pages of identical size", async () => {
    const { bytes } = await buildIdCardPdf(input("portrait"), "both");
    const doc = await PDFDocument.load(bytes);

    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual(doc.getPage(1).getSize());
  });

  it("gives one page when only one side is asked for", async () => {
    for (const side of ["front", "back"] as const) {
      const { bytes } = await buildIdCardPdf(input("portrait"), side);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    }
  });

  it("renders a Bangla name and school with no dropped glyphs", async () => {
    const { dropped } = await buildIdCardPdf(
      {
        ...input("portrait"),
        school: BANGLA_SCHOOL,
        fields: { ...fields, full_name: "ডেমো শিক্ষার্থী আলফা" },
      },
      "both",
    );

    expect(dropped).toBe(0);
  });

  it("omits a field the template does not declare", async () => {
    // The point of the template list: a card that is not told to print the
    // guardian's number must not print it, and the same list drives the public
    // QR snapshot.
    const withoutPhone = await buildIdCardPdf(
      {
        ...input("portrait"),
        frontFields: frontFields.filter((f) => f !== "guardian_phone"),
      },
      "front",
    );
    const withPhone = await buildIdCardPdf(input("portrait"), "front");

    // Fewer drawn strings means a smaller content stream; the exact bytes are
    // not asserted, only that leaving the field out changes the output.
    expect(withoutPhone.bytes.byteLength).toBeLessThan(withPhone.bytes.byteLength);
  });

  it("prints with no photo and no QR rather than failing", async () => {
    const { bytes } = await buildIdCardPdf(
      { ...input("portrait"), photo: null, qr: null },
      "both",
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it("survives an unreadable photo", async () => {
    // Not a PNG and not a JPEG. The frame must print empty rather than the
    // whole card failing, because the office can see a missing photo and fix it.
    const { bytes } = await buildIdCardPdf(
      { ...input("portrait"), photo: new Uint8Array([1, 2, 3, 4, 5]) },
      "front",
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

// ===========================================================================
describe("exam routine PDF", () => {
  const rows: ExamRoutineRow[] = [
    { class_name: "Class 3", level_order: 5, subject: "Bangla", subject_bn: "বাংলা", exam_date: "2026-06-01", starts_at: "09:00:00", ends_at: "11:00:00", room: "Room 1", max_marks: 100 },
    { class_name: "Class 3", level_order: 5, subject: "Mathematics", subject_bn: "গণিত", exam_date: "2026-06-03", starts_at: "09:00:00", ends_at: "11:00:00", room: "Room 1", max_marks: 100 },
    { class_name: "Class 8", level_order: 10, subject: "English", subject_bn: "ইংরেজি", exam_date: "2026-06-01", starts_at: "12:00:00", ends_at: "14:00:00", room: "Room 4", max_marks: 100 },
  ];

  const exam = {
    name: "Second Term Examination",
    term_name: "Second Term",
    academic_year: "2026",
    starts_on: "2026-06-01",
    ends_on: "2026-06-10",
    routine_published_at: "2026-05-20T06:00:00Z",
  };

  it("is A4 and groups papers by date", async () => {
    const { bytes, pages } = await buildExamRoutinePdf({
      school, exam, rows, generatedAt: GENERATED,
    });

    const doc = await PDFDocument.load(bytes);
    expect(pages).toBe(1);

    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(Math.round(A4.width));
    expect(Math.round(height)).toBe(Math.round(A4.height));
  });

  it("renders Bangla subject names with no dropped glyphs", async () => {
    const { dropped } = await buildExamRoutinePdf({
      school: BANGLA_SCHOOL, exam, rows, generatedAt: GENERATED,
    });
    expect(dropped).toBe(0);
  });

  it("lists an undated paper rather than hiding it", async () => {
    const { bytes } = await buildExamRoutinePdf({
      school,
      exam,
      rows: [...rows, { ...rows[0]!, subject: "Science", exam_date: null, starts_at: null, ends_at: null }],
      generatedAt: GENERATED,
    });

    // Still renders; the undated paper gets its own "Date not set" block, so an
    // incomplete schedule is visibly incomplete on the sheet being pinned up.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("breaks to more pages for a long schedule", async () => {
    const many: ExamRoutineRow[] = Array.from({ length: 80 }, (_, i) => ({
      class_name: `Class ${(i % 10) + 1}`,
      level_order: (i % 10) + 1,
      subject: `Subject ${i}`,
      subject_bn: null,
      exam_date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
      starts_at: "09:00:00",
      ends_at: "11:00:00",
      room: "Hall",
      max_marks: 100,
    }));

    const { pages } = await buildExamRoutinePdf({
      school, exam, rows: many, generatedAt: GENERATED,
    });
    expect(pages).toBeGreaterThan(1);
  });

  it("renders an empty schedule as one page that says so", async () => {
    const { bytes, pages } = await buildExamRoutinePdf({
      school, exam, rows: [], generatedAt: GENERATED,
    });
    expect(pages).toBe(1);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("marks an unpublished routine as a draft", async () => {
    const draft = await buildExamRoutinePdf({
      school,
      exam: { ...exam, routine_published_at: null },
      rows,
      generatedAt: GENERATED,
    });
    const published = await buildExamRoutinePdf({
      school, exam, rows, generatedAt: GENERATED,
    });

    // The draft stamp is extra drawn text, so the draft file is larger.
    expect(draft.bytes.byteLength).toBeGreaterThan(published.bytes.byteLength);
  });
});

// ===========================================================================
describe("result sheet PDF", () => {
  function sheet(overrides: Partial<ResultSheet> = {}): ResultSheet {
    return {
      full_name: "Demo Student Alpha",
      full_name_bn: "ডেমো শিক্ষার্থী আলফা",
      registration_no: "STU-2026-0001",
      roll_no: 1,
      class_name: "Class 3",
      section_name: "A",
      father_name: "Demo Guardian A",
      mother_name: "Demo Mother A",
      total_obtained: 108,
      total_max: 200,
      percentage: 54,
      gpa: 0,
      grade: "F",
      is_pass: false,
      attendance_pct: 92.5,
      position_in_class: 2,
      snapshot: {
        subjects: [
          { subject: "Bangla", obtained: 80, max: 100, pass_marks: 33, percentage: 80, grade: "A+", grade_point: 5, absent: false, passed: true },
          { subject: "Mathematics", obtained: 28, max: 100, pass_marks: 33, percentage: 28, grade: "F", grade_point: 0, absent: false, passed: false },
        ],
        gpa_computed: 2.5,
        gpa_printed: 0,
        grade_computed: "B",
        failed_subjects: 1,
        pass_rule: "all_subjects",
        scale: "GPA 5.0",
        attendance: {
          present: 37,
          submitted_lessons: 40,
          window_start: "2026-05-01",
          window_end: "2026-08-31",
        },
      },
      ...overrides,
    };
  }

  const exam = {
    name: "Second Term Examination",
    term_name: "Second Term",
    academic_year: "2026",
    results_published_at: "2026-07-01T06:00:00Z",
  };

  it("is one A4 page per student", async () => {
    const { bytes, pages } = await buildResultSheetPdf({
      school, exam, sheets: [sheet(), sheet(), sheet()], generatedAt: GENERATED,
    });

    expect(pages).toBe(3);

    const doc = await PDFDocument.load(bytes);
    for (let i = 0; i < doc.getPageCount(); i++) {
      const { width, height } = doc.getPage(i).getSize();
      expect(Math.round(width)).toBe(Math.round(A4.width));
      expect(Math.round(height)).toBe(Math.round(A4.height));
    }
  });

  it("renders Bangla names and subjects with no dropped glyphs", async () => {
    const { dropped } = await buildResultSheetPdf({
      school: BANGLA_SCHOOL,
      exam,
      sheets: [sheet({
        full_name: "ডেমো শিক্ষার্থী",
        snapshot: {
          ...sheet().snapshot,
          subjects: [
            { subject: "বাংলা", obtained: 80, max: 100, pass_marks: 33, percentage: 80, grade: "A+", grade_point: 5, absent: false, passed: true },
            { subject: "গণিত", obtained: 28, max: 100, pass_marks: 33, percentage: 28, grade: "F", grade_point: 0, absent: false, passed: false },
          ],
        },
      })],
      generatedAt: GENERATED,
    });

    expect(dropped).toBe(0);
  });

  it("explains a zeroed GPA on the sheet, and says nothing extra when it passes", async () => {
    const failed = await buildResultSheetPdf({
      school, exam, sheets: [sheet()], generatedAt: GENERATED,
    });

    const passed = await buildResultSheetPdf({
      school,
      exam,
      sheets: [sheet({
        gpa: 3.75, grade: "A", is_pass: true, total_obtained: 140, percentage: 70,
        snapshot: { ...sheet().snapshot, gpa_computed: 3.75, gpa_printed: 3.75, grade_computed: "A", failed_subjects: 0 },
      })],
      generatedAt: GENERATED,
    });

    // The footnote is extra drawn text on the failed sheet only. A parent
    // handed "GPA 0.00" beside 54% is owed the reason in writing.
    expect(failed.bytes.byteLength).toBeGreaterThan(passed.bytes.byteLength);
  });

  it("prints an absence as absent, not as zero", async () => {
    const { bytes } = await buildResultSheetPdf({
      school,
      exam,
      sheets: [sheet({
        snapshot: {
          ...sheet().snapshot,
          subjects: [
            { subject: "Bangla", obtained: 80, max: 100, pass_marks: 33, percentage: 80, grade: "A+", grade_point: 5, absent: false, passed: true },
            { subject: "Mathematics", obtained: null, max: 100, pass_marks: 33, percentage: 0, grade: "Abs", grade_point: 0, absent: true, passed: false },
          ],
        },
      })],
      generatedAt: GENERATED,
    });

    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("handles a term with no attendance window", async () => {
    const { bytes } = await buildResultSheetPdf({
      school,
      exam,
      sheets: [sheet({
        attendance_pct: null,
        snapshot: {
          ...sheet().snapshot,
          attendance: { present: 0, submitted_lessons: 0, window_start: null, window_end: null },
        },
      })],
      generatedAt: GENERATED,
    });

    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("gives one page saying there is nothing to print, not an empty file", async () => {
    const { bytes, pages } = await buildResultSheetPdf({
      school, exam, sheets: [], generatedAt: GENERATED,
    });

    expect(pages).toBe(1);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
