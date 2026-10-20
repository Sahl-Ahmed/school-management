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
  /**
   * The characters that forced UCS-2, when the text is otherwise Latin.
   *
   * This exists because of a real and expensive surprise: the shipped English
   * result template contained an em dash, which is not in GSM-7, so a
   * 96-character English message billed as TWO segments instead of one —
   * doubling the cost of every result SMS the school would ever send, for one
   * piece of punctuation. Naming the offender lets the office fix it; a bare
   * "2 segments" does not.
   *
   * Empty when the text is genuinely non-Latin (Bangla), where UCS-2 is
   * unavoidable and there is nothing to fix.
   */
  forcedBy: string[];
};

// Single-message capacity, and per-part capacity once concatenated. A
// concatenated message spends 6-7 bytes of each part on the UDH that tells the
// handset how to reassemble it, which is why the per-part figures are smaller.
const GSM7_SINGLE = 160;
const GSM7_PER_PART = 153;
const UCS2_SINGLE = 70;
const UCS2_PER_PART = 67;

/** Bengali, Devanagari and other scripts that simply cannot be GSM-7. */
const NON_LATIN = /[^\u0000-\u024F\u2000-\u206F\u20A0-\u20CF]/u;

export function countSegments(body: string): SegmentInfo {
  let isUnicode = false;
  let units = 0;

  // Every offender is collected rather than stopping at the first, so the
  // caller can list them all instead of reporting one and leaving the next to
  // be discovered on the following edit.
  const offenders = new Set<string>();

  for (const ch of body) {
    if (GSM7.includes(ch)) {
      units += 1;
    } else if (GSM7_EXTENDED.includes(ch)) {
      units += 2;
    } else {
      isUnicode = true;
      offenders.add(ch);
    }
  }

  if (isUnicode) {
    // UCS-2 counts UTF-16 code units, so an astral character such as an emoji
    // costs two. String.length is exactly that count.
    units = body.length;

    /*
     * Only report offenders worth acting on.
     *
     * If the text contains a non-Latin script, UCS-2 is unavoidable and
     * listing the Bengali letters as "the problem" would be nonsense. It is
     * only actionable when the text is otherwise plain Latin and a stray
     * dash, quote or ellipsis is what tipped it over.
     */
    const actionable = NON_LATIN.test(body)
      ? []
      : [...offenders].filter((ch) => !/\s/u.test(ch));

    return {
      isUnicode: true,
      characters: units,
      segments: units <= UCS2_SINGLE ? 1 : Math.ceil(units / UCS2_PER_PART),
      forcedBy: actionable,
    };
  }

  return {
    isUnicode: false,
    characters: units,
    segments: units <= GSM7_SINGLE ? 1 : Math.ceil(units / GSM7_PER_PART),
    forcedBy: [],
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
