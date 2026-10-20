import { describe, expect, it } from "vitest";
import {
  CARD_COLOR_PRESETS,
  DEFAULT_CARD_COLOR,
  contrastRatio,
  isHexColor,
  luminance,
  normaliseHex,
  parseHex,
  readableOn,
} from "@/lib/school/contrast";
import {
  PREVIEW_VALUES,
  renderTemplate,
  templatePlaceholders,
} from "@/lib/sms/templates";
import { countSegments } from "@/lib/sms/segments";
import { publicCardFields, unpublishableFields, CARD_FIELDS } from "@/lib/school/card-fields";

/**
 * The computed pieces of phase 7.
 *
 * These are pure functions whose output appears on a screen or in a message a
 * guardian receives, so they are worth asserting directly rather than only
 * through the pages that use them.
 */

describe("readable text on an author-chosen background", () => {
  it("picks white on a dark colour and dark on a light one", () => {
    const dark = readableOn("#14532d");
    expect(dark.text).toBe("#ffffff");

    const light = readableOn("#f3f4f6");
    expect(light.text).toBe("#121712");
  });

  it("reaches WCAG AA for every curated preset", () => {
    for (const preset of CARD_COLOR_PRESETS) {
      const result = readableOn(preset.value);
      expect(
        result.meetsAA,
        `${preset.name} (${preset.value}) must be readable: got ${result.ratio}:1`,
      ).toBe(true);
    }
  });

  it("adjusts a mid-tone that neither black nor white can read", () => {
    /*
     * Mid-tones are the realistic failure, and there are a lot of them: a
     * sweep of the colour cube finds 216 colours that clear 4.5:1 against
     * NEITHER black nor white. These four are from that set. The specification
     * asks for the shade to be adjusted and said so, rather than shipping
     * grey-on-grey.
     */
    for (const midtone of ["#0077dd", "#008866", "#008888", "#0077ff"]) {
      const result = readableOn(midtone);

      expect(result.meetsAA, `${midtone} ended at ${result.ratio}:1`).toBe(true);
      expect(
        result.background.toLowerCase(),
        `${midtone} should have been nudged to stay legible`,
      ).not.toBe(midtone);
    }
  });

  it("never returns a pair below AA, for any colour at all", () => {
    // A spread across the hue and lightness space, including the worst cases.
    const samples = [
      "#808080", "#777777", "#888888", "#7f7f7f",
      "#996633", "#669933", "#336699", "#993366",
      "#ff0000", "#00ff00", "#0000ff", "#ffff00",
      "#000000", "#ffffff", "#010101", "#fefefe",
    ];

    for (const colour of samples) {
      const result = readableOn(colour);
      expect(result.meetsAA, `${colour} ended at ${result.ratio}:1`).toBe(true);
    }
  });

  it("falls back to the default for nonsense input rather than failing", () => {
    for (const bad of ["", "not a colour", "#12", "rgb(1,2,3)", null, undefined]) {
      const result = readableOn(bad as string);
      expect(result.meetsAA).toBe(true);
      expect(isHexColor(result.background)).toBe(true);
    }

    expect(readableOn(null).background).toBe(DEFAULT_CARD_COLOR);
  });

  it("accepts three-digit hex and normalises it", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(normaliseHex("#FFF")).toBe("#ffffff");
    expect(normaliseHex("1f6b45")).toBe("#1f6b45");
    expect(normaliseHex("nope")).toBeNull();
  });

  it("computes luminance and contrast to the WCAG definition", () => {
    // Black on white is the maximum, 21:1.
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    // A colour against itself is 1:1.
    expect(contrastRatio([31, 107, 69], [31, 107, 69])).toBeCloseTo(1, 5);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(luminance([0, 0, 0])).toBeCloseTo(0, 5);
  });

  it("gives a muted secondary colour that is not the primary one", () => {
    const result = readableOn("#1f6b45");
    expect(result.textMuted).not.toBe(result.text);
    expect(isHexColor(result.textMuted)).toBe(true);
  });
});

describe("message templates", () => {
  it("fills placeholders from the payload", () => {
    const { body, missing } = renderTemplate(
      "{school}: {student} was {status} on {date}.",
      { school: "SCH", student: "Alpha", status: "present", date: "04 May 2026" },
    );

    expect(body).toBe("SCH: Alpha was present on 04 May 2026.");
    expect(missing).toEqual([]);
  });

  it("LEAVES a missing placeholder visible rather than blanking it", () => {
    /*
     * The difference that matters. "was {status} on 04 May" is obviously broken
     * and gets caught in the preview; "was  on 04 May" looks almost right and
     * goes out to four hundred guardians.
     */
    const { body, missing } = renderTemplate(
      "{school}: {student} was {status} on {date}.",
      { school: "SCH", student: "Alpha", date: "04 May 2026" },
    );

    expect(body).toContain("{status}");
    expect(body).not.toBe("SCH: Alpha was  on 04 May 2026.");
    expect(missing).toEqual(["status"]);
  });

  it("treats an empty string as missing, not as a value", () => {
    const { missing } = renderTemplate("{a}-{b}", { a: "x", b: "" });
    expect(missing).toEqual(["b"]);
  });

  it("reports payload facts the template never uses", () => {
    const { unused } = renderTemplate("{a}", { a: 1, b: 2, c: 3 });
    expect(unused.sort()).toEqual(["b", "c"]);
  });

  it("lists a template's placeholders once each, in order", () => {
    expect(templatePlaceholders("{b} {a} {b} {c}")).toEqual(["b", "a", "c"]);
  });

  it("renders every shipped placeholder from the preview values", () => {
    // The preview must never show a hole: if a template placeholder has no
    // sample value, the office sees a broken preview for a working template.
    const shipped = [
      "{school}: {student} was {status} on {date}. Present {present}/{lessons} lessons.",
      "{school}: {student} — {exam} result. Marks {obtained}/{max} ({percentage}%), GPA {gpa}, grade {grade}. {outcome}.",
      "{school}: {student} scored {obtained}/{max} in {test} ({subject}) on {date}.",
      "{school}: your verification code is {code}. It expires in {minutes} minutes. Do not share it.",
    ];

    for (const template of shipped) {
      const { missing } = renderTemplate(template, PREVIEW_VALUES);
      expect(missing, `preview values are missing ${missing.join(", ")}`).toEqual([]);
    }
  });
});

describe("segment counting names what costs money", () => {
  it("bills a 96-character English message as ONE segment", () => {
    const body =
      "SCH: Demo Student - Annual Examination result. Marks 412/500 (82.4%), GPA 4.50, grade A. Passed.";

    const info = countSegments(body);
    expect(info.isUnicode).toBe(false);
    expect(info.segments).toBe(1);
    expect(info.forcedBy).toEqual([]);
  });

  it("catches the em dash that doubled the bill, and names it", () => {
    /*
     * The real bug this guards. The shipped English result template contained
     * U+2014 EM DASH, which is not in GSM 03.38 — and one character outside
     * that alphabet forces the WHOLE message into UCS-2, where a segment is 70
     * characters rather than 160. The same 96-character message then costs two
     * segments instead of one: double the bill, for a dash.
     */
    const withDash =
      "SCH: Demo Student — Annual Examination result. Marks 412/500 (82.4%), GPA 4.50, grade A. Passed.";

    const info = countSegments(withDash);
    expect(info.isUnicode).toBe(true);
    expect(info.segments).toBe(2);
    expect(info.forcedBy, "the office must be told which character did it")
      .toEqual(["—"]);
  });

  it("reports nothing actionable for genuine Bangla", () => {
    // Bengali cannot be GSM-7 at any price, so listing its letters as "the
    // problem" would be nonsense and would send the office on a wild goose
    // chase through text it cannot change.
    const bangla = "SCH: আজ উপস্থিত 4/5 ক্লাস।";

    const info = countSegments(bangla);
    expect(info.isUnicode).toBe(true);
    expect(info.forcedBy).toEqual([]);
  });

  it("names every offender, not just the first", () => {
    const messy = "Result — “good” … done";
    const info = countSegments(messy);

    expect(info.forcedBy.sort()).toEqual(["—", "…", "“", "”"].sort());
  });

  it("ignores whitespace, which is never the thing to fix", () => {
    const info = countSegments(["line one", "line two — here"].join("\n"));
    expect(info.forcedBy).toEqual(["—"]);
  });

  it("counts a long Bangla message across concatenated parts", () => {
    // 100 Bengali characters: over the 70 single-message limit, so it splits
    // into parts of 67.
    const long = "অ".repeat(100);
    const info = countSegments(long);

    expect(info.isUnicode).toBe(true);
    expect(info.characters).toBe(100);
    expect(info.segments).toBe(Math.ceil(100 / 67));
  });
});

describe("the card field list", () => {
  it("renders only the keys a snapshot actually carries", () => {
    const fields = publicCardFields({
      full_name: "Demo Student Alpha",
      registration_no: "STU-2026-0001",
      roll_no: 1,
      blood_group: null,
      session: "",
      // Not a display field: a Storage path for the PDF generator.
      photo_path: "students/alpha.jpg",
    });

    const keys = fields.map((f) => f.key);
    expect(keys).toEqual(["full_name", "registration_no", "roll_no"]);
    expect(keys, "a storage path is not a card detail").not.toContain("photo_path");
  });

  it("includes the guardian phone, because the card prints it", () => {
    const fields = publicCardFields({ guardian_phone: "+8801300000301" });
    expect(fields.map((f) => f.key)).toEqual(["guardian_phone"]);
    expect(fields[0]!.label).toBe("Contact");
  });

  it("flags a printed field the page could not show", () => {
    expect(unpublishableFields(["full_name", "photo", "office_phone"])).toEqual([]);
    expect(unpublishableFields(["full_name", "father_name"])).toEqual(["father_name"]);
  });

  it("gives every field a label", () => {
    for (const field of CARD_FIELDS) {
      expect(field.label.length, `${field.key} needs a label`).toBeGreaterThan(0);
    }
  });
});
