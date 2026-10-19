/**
 * Billable SMS segment counting.
 *
 * Separate from the dispatcher (./index.ts) because that file is server-only
 * and this is pure arithmetic that both the tests and any future cost preview
 * in the UI need.
 *
 * Why this matters more than it looks: Bangla cannot be encoded in GSM-7, so a
 * Bangla message is sent as UCS-2 and fits 70 characters per segment instead of
 * 160. A 160-character Bangla attendance notice is three billable segments, not
 * one. Across every student, every school day, mis-counting this understates
 * the school's SMS bill threefold.
 */

/** GSM 03.38 basic character set. Anything outside it forces UCS-2. */
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅå_ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà" +
  "ΔΦΓΛΩΠΨΣΘΞ";

/** These are sent as an escape plus the character, so they cost two positions. */
const GSM7_EXTENDED = "^{}\\[~]|€";

export type SegmentInfo = {
  isUnicode: boolean;
  /** Billable positions used, not necessarily the string's length. */
  characters: number;
  segments: number;
};

// Single-message capacity, and per-part capacity once concatenated. A
// concatenated message spends 6-7 bytes of each part on the UDH that tells the
// handset how to reassemble it, which is why the per-part figures are smaller.
const GSM7_SINGLE = 160;
const GSM7_PER_PART = 153;
const UCS2_SINGLE = 70;
const UCS2_PER_PART = 67;

export function countSegments(body: string): SegmentInfo {
  let isUnicode = false;
  let units = 0;

  for (const ch of body) {
    if (GSM7.includes(ch)) {
      units += 1;
    } else if (GSM7_EXTENDED.includes(ch)) {
      units += 2;
    } else {
      isUnicode = true;
      break;
    }
  }

  if (isUnicode) {
    // UCS-2 counts UTF-16 code units, so an astral character such as an emoji
    // costs two. String.length is exactly that count.
    units = body.length;
    return {
      isUnicode: true,
      characters: units,
      segments: units <= UCS2_SINGLE ? 1 : Math.ceil(units / UCS2_PER_PART),
    };
  }

  return {
    isUnicode: false,
    characters: units,
    segments: units <= GSM7_SINGLE ? 1 : Math.ceil(units / GSM7_PER_PART),
  };
}

/** Rough cost preview. The real rate comes from the provider account. */
export function estimateSegments(bodies: string[]): {
  messages: number;
  segments: number;
  unicodeMessages: number;
} {
  let segments = 0;
  let unicodeMessages = 0;

  for (const body of bodies) {
    const info = countSegments(body);
    segments += info.segments;
    if (info.isUnicode) unicodeMessages += 1;
  }

  return { messages: bodies.length, segments, unicodeMessages };
}
