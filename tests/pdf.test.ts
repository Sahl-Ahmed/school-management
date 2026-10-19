import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  buildSectionRoutinePdf,
  buildSchoolRoutinePdf,
  A4_POINTS,
  type RoutineSection,
  type SchoolBranding,
} from "@/lib/pdf/routine";

/**
 * Routine PDF tests.
 *
 * These check the things that actually go wrong with generated PDFs: the page
 * is the wrong size, the content runs off the sheet, or a non-Latin character
 * crashes the generator. Checking the bytes "look like a PDF" would prove
 * nothing useful.
 *
 * The A4 assertion matters because a sheet that is silently US Letter prints
 * with clipped edges on every school printer in Bangladesh.
 */

const school: SchoolBranding = {
  name: "Test School",
  address: "Dhaka, Bangladesh",
  office_phone: "+8801300000000",
  email: "office@school.invalid",
};

const TEACHING_DAYS = [0, 1, 2, 3, 4]; // Sunday to Thursday

function section(overrides: Partial<RoutineSection> = {}): RoutineSection {
  return {
    class_name: "Class 3",
    section_name: "A",
    level_order: 5,
    periods: [
      { weekday: 0, period_no: 1, starts_at: "08:00:00", ends_at: "08:45:00", subject_name: "Bangla", teacher_name: "Demo Teacher One" },
      { weekday: 0, period_no: 2, starts_at: "08:45:00", ends_at: "09:30:00", subject_name: "Mathematics", teacher_name: "Demo Teacher Two" },
      { weekday: 1, period_no: 1, starts_at: "08:00:00", ends_at: "08:45:00", subject_name: "Bangla", teacher_name: "Demo Teacher One" },
      { weekday: 1, period_no: 2, starts_at: "08:45:00", ends_at: "09:30:00", subject_name: "Mathematics", teacher_name: "Demo Teacher Two" },
    ],
    ...overrides,
  };
}

describe("per-class routine PDF", () => {
  it("is a single A4 page", async () => {
    const { bytes } = await buildSectionRoutinePdf(
      school, section(), TEACHING_DAYS, "2026", "19 October 2026",
    );

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);

    const page = doc.getPage(0);
    // A4 is 595.28 x 841.89pt. US Letter is 612 x 792 — a sheet that silently
    // became Letter would clip on every print.
    expect(page.getWidth()).toBeCloseTo(A4_POINTS.width, 1);
    expect(page.getHeight()).toBeCloseTo(A4_POINTS.height, 1);
    expect(page.getWidth()).toBeLessThan(600);
  });

  it("carries the school name and class in its metadata", async () => {
    const { bytes } = await buildSectionRoutinePdf(
      school, section(), TEACHING_DAYS, "2026", "19 October 2026",
    );

    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toContain("Class 3");
    expect(doc.getAuthor()).toBe("Test School");
  });

  it("renders a section with no periods without failing", async () => {
    const { bytes } = await buildSectionRoutinePdf(
      school, section({ periods: [] }), TEACHING_DAYS, "2026", "19 October 2026",
    );

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("reports dropped glyphs rather than throwing on Bangla", async () => {
    // The standard PDF fonts are WinAnsi and cannot encode Bangla. The
    // generator must degrade and SAY SO, not crash and not silently mangle.
    const { bytes, droppedGlyphs } = await buildSectionRoutinePdf(
      school,
      section({
        periods: [{
          weekday: 0, period_no: 1, starts_at: "08:00:00", ends_at: "08:45:00",
          subject_name: "বাংলা",
          teacher_name: "শিক্ষক",
        }],
      }),
      TEACHING_DAYS, "2026", "19 October 2026",
    );

    expect(droppedGlyphs).toBeGreaterThan(0);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("reports no dropped glyphs for Latin content", async () => {
    const { droppedGlyphs } = await buildSectionRoutinePdf(
      school, section(), TEACHING_DAYS, "2026", "19 October 2026",
    );
    expect(droppedGlyphs).toBe(0);
  });

  it("truncates a long subject name instead of overflowing the column", async () => {
    // No exception, and still one page: the fit() helper must have cut it.
    const { bytes } = await buildSectionRoutinePdf(
      school,
      section({
        periods: [{
          weekday: 0, period_no: 1, starts_at: "08:00:00", ends_at: "08:45:00",
          subject_name: "Environmental Science and Social Studies Combined Paper II",
          teacher_name: "A Teacher With A Very Long Name Indeed For Testing",
        }],
      }),
      TEACHING_DAYS, "2026", "19 October 2026",
    );

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

describe("school-wide routine PDF", () => {
  it("fits a handful of classes on one A4 page", async () => {
    const sections = [3, 4, 5].map((level) =>
      section({ class_name: `Class ${level - 2}`, level_order: level }),
    );

    const { bytes } = await buildSchoolRoutinePdf(
      school, sections, TEACHING_DAYS, "2026", "19 October 2026",
    );

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(A4_POINTS.width, 1);
  });

  it("breaks to further pages rather than overflowing", async () => {
    // Twelve classes cannot fit one sheet, so the generator must paginate.
    const sections = Array.from({ length: 12 }, (_, i) =>
      section({ class_name: `Class ${i + 1}`, level_order: i + 1 }),
    );

    const { bytes } = await buildSchoolRoutinePdf(
      school, sections, TEACHING_DAYS, "2026", "19 October 2026",
    );

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);

    // Every page is A4, not just the first.
    for (let i = 0; i < doc.getPageCount(); i += 1) {
      expect(doc.getPage(i).getWidth()).toBeCloseTo(A4_POINTS.width, 1);
      expect(doc.getPage(i).getHeight()).toBeCloseTo(A4_POINTS.height, 1);
    }
  });

  it("skips classes with no periods rather than printing empty grids", async () => {
    const sections = [
      section({ class_name: "Class 1", level_order: 3 }),
      section({ class_name: "Class 2", level_order: 4, periods: [] }),
    ];

    const { bytes } = await buildSchoolRoutinePdf(
      school, sections, TEACHING_DAYS, "2026", "19 October 2026",
    );

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("produces a valid single page when no class has a routine", async () => {
    const { bytes } = await buildSchoolRoutinePdf(
      school, [], TEACHING_DAYS, "2026", "19 October 2026",
    );

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("handles a six-day teaching week without changing the page size", async () => {
    const { bytes } = await buildSchoolRoutinePdf(
      school, [section()], [0, 1, 2, 3, 4, 6], "2026", "19 October 2026",
    );

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getHeight()).toBeCloseTo(A4_POINTS.height, 1);
  });
});
