import { describe, expect, it } from "vitest";
import { countSegments } from "@/lib/sms/segments";

/**
 * Billable segment counting.
 *
 * This decides what the school is charged. Bangla is UCS-2, so a Bangla message
 * fits 70 characters per segment against 160 for Latin — a 160-character Bangla
 * notice is three segments, not one. Getting this wrong understates the SMS
 * bill by a factor of three on every Bangla message the school sends, across
 * every student, every school day.
 */
describe("countSegments", () => {
  it("counts a short Latin message as one GSM-7 segment", () => {
    const r = countSegments("Your child attended all classes today.");
    expect(r.isUnicode).toBe(false);
    expect(r.segments).toBe(1);
  });

  it("fits exactly 160 GSM-7 characters in one segment", () => {
    const r = countSegments("a".repeat(160));
    expect(r.segments).toBe(1);
  });

  it("splits at 161 GSM-7 characters into two segments of 153", () => {
    const r = countSegments("a".repeat(161));
    expect(r.segments).toBe(2);
  });

  it("charges extended GSM-7 characters as two positions each", () => {
    // 80 opening braces occupy 160 positions: still one segment.
    expect(countSegments("{".repeat(80)).segments).toBe(1);
    // 81 tips it to 162 positions, so two.
    expect(countSegments("{".repeat(81)).segments).toBe(2);
  });

  it("treats Bangla as unicode with 70 characters per segment", () => {
    const r = countSegments("আপনার সন্তান আজ সব ক্লাসে উপস্থিত ছিল।");
    expect(r.isUnicode).toBe(true);
    expect(r.segments).toBe(1);
  });

  it("fits exactly 70 Bangla characters in one segment", () => {
    const r = countSegments("অ".repeat(70));
    expect(r.isUnicode).toBe(true);
    expect(r.segments).toBe(1);
  });

  it("splits at 71 Bangla characters into two segments of 67", () => {
    const r = countSegments("অ".repeat(71));
    expect(r.segments).toBe(2);
  });

  it("counts a 160-character Bangla message as three segments, not one", () => {
    // The mistake this test exists to prevent.
    const r = countSegments("অ".repeat(160));
    expect(r.isUnicode).toBe(true);
    expect(r.segments).toBe(3);
  });

  it("a single Bangla character makes the whole message unicode", () => {
    const r = countSegments("Attendance: আজ");
    expect(r.isUnicode).toBe(true);
    expect(r.segments).toBe(1);
  });

  it("handles an empty body without dividing by zero", () => {
    const r = countSegments("");
    expect(r.segments).toBe(1);
    expect(r.characters).toBe(0);
  });

  it("counts an emoji as two UTF-16 units", () => {
    // Astral characters cost two UCS-2 units, which is why 35 of them fill a
    // 70-unit segment.
    const r = countSegments("😀".repeat(35));
    expect(r.isUnicode).toBe(true);
    expect(r.segments).toBe(1);
    expect(countSegments("😀".repeat(36)).segments).toBe(2);
  });
});
