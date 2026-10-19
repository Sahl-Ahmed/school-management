import { describe, expect, it } from "vitest";
import {
  normaliseBdPhone,
  isNormalisedBdPhone,
  formatBdPhoneForDisplay,
} from "@/lib/phone";

/**
 * Phone normalisation matters more than it looks: the stored form is what the
 * database CHECK accepts, what the SMS provider dials, and what the OTP flow
 * matches against. A number accepted in two different shapes would let one
 * guardian exist twice.
 */
describe("normaliseBdPhone", () => {
  it("accepts the local form", () => {
    expect(normaliseBdPhone("01712345678")).toBe("+8801712345678");
  });

  it("accepts the country code with and without a plus", () => {
    expect(normaliseBdPhone("8801712345678")).toBe("+8801712345678");
    expect(normaliseBdPhone("+8801712345678")).toBe("+8801712345678");
  });

  it("accepts the international prefix", () => {
    expect(normaliseBdPhone("008801712345678")).toBe("+8801712345678");
  });

  it("strips spaces, dashes and brackets", () => {
    expect(normaliseBdPhone("+88 01712-345 678")).toBe("+8801712345678");
    expect(normaliseBdPhone("(017) 1234 5678")).toBe("+8801712345678");
  });

  it("accepts every operator prefix from 013 to 019", () => {
    for (const p of [3, 4, 5, 6, 7, 8, 9]) {
      expect(normaliseBdPhone(`01${p}12345678`)).toBe(`+8801${p}12345678`);
    }
  });

  it("rejects numbers that are not Bangladeshi mobiles", () => {
    expect(normaliseBdPhone("01012345678")).toBeNull();  // 010 is not issued
    expect(normaliseBdPhone("01212345678")).toBeNull();  // 012 is not issued
    expect(normaliseBdPhone("0171234567")).toBeNull();   // one digit short
    expect(normaliseBdPhone("017123456789")).toBeNull(); // one digit long
    expect(normaliseBdPhone("+14155552671")).toBeNull(); // not Bangladesh
    expect(normaliseBdPhone("")).toBeNull();
    expect(normaliseBdPhone("not a phone")).toBeNull();
  });

  it("is idempotent", () => {
    const once = normaliseBdPhone("01712345678")!;
    expect(normaliseBdPhone(once)).toBe(once);
  });
});

describe("isNormalisedBdPhone", () => {
  it("matches the stored canonical form only", () => {
    expect(isNormalisedBdPhone("+8801712345678")).toBe(true);
    expect(isNormalisedBdPhone("01712345678")).toBe(false);
    expect(isNormalisedBdPhone("8801712345678")).toBe(false);
  });
});

describe("formatBdPhoneForDisplay", () => {
  it("renders a stored number in the familiar local grouping", () => {
    expect(formatBdPhoneForDisplay("+8801712345678")).toBe("01712-345678");
  });

  it("passes through anything not in canonical form unchanged", () => {
    expect(formatBdPhoneForDisplay("unknown")).toBe("unknown");
  });
});
