import "server-only";

/*
 * This import must come before anything reaches fontkit's complex-script path.
 *
 * @pdf-lib/fontkit ships a Babel-transpiled bundle whose Indic, Arabic and
 * Universal shapers are generator functions expecting a `regeneratorRuntime`
 * global that the bundle does not include. Without this polyfill, measuring a
 * single Bengali character throws "regeneratorRuntime is not defined". Latin
 * works regardless, because it takes the simple shaper and never reaches a
 * generator — which is exactly why the problem stayed hidden until Bangla was
 * actually tried.
 *
 * The upstream `fontkit` package needs no polyfill, but its v2 subsetter
 * dropped the `encodeStream` method pdf-lib calls, so subsetting fails there
 * and the full 141 KB font embeds in every document. The polyfill is the
 * smaller compromise: it keeps subsetting, and a routine stays ~20 KB rather
 * than ~300 KB.
 *
 * Importing this module is what installs the polyfill, so every PDF generator
 * in this directory imports from here rather than carrying its own copy. That
 * is the main reason this file exists: the polyfill was duplicated in two
 * generators and would have been duplicated in four more.
 */
import "regenerator-runtime/runtime.js";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/**
 * Shared geometry, ink and text helpers for every PDF this app produces.
 *
 * Text is set in Noto Sans Bengali, embedded from `./fonts`, which covers both
 * Bengali and basic Latin. That matters for more than subject names: a school
 * whose own name is written in Bangla would otherwise have every sheet it
 * prints headed by question marks.
 *
 * Bengali needs real shaping rather than codepoint-to-glyph mapping — `ি` is
 * typed after its consonant but renders before it, and clusters like `ক্ষ` form
 * conjunct ligatures. pdf-lib delegates layout to fontkit, whose Indic shaper
 * performs both; the conjunct measurably occupies less width than its unligated
 * parts, which is asserted in tests/pdf.test.ts.
 */

/** A4 at 72dpi, in points. */
export const A4 = { width: 595.28, height: 841.89 };

/** Millimetres to PDF points, for the PVC card sizes. */
export const mm = (value: number): number => (value * 72) / 25.4;

/** 12.7mm — comfortable on a school printer. */
export const MARGIN = 36;

export const INK = rgb(0.07, 0.09, 0.08);
export const MUTED = rgb(0.42, 0.44, 0.43);
export const HAIRLINE = rgb(0.78, 0.8, 0.79);
export const HEADER_FILL = rgb(0.94, 0.96, 0.95);
export const ACCENT = rgb(0.18, 0.42, 0.29);
export const ACCENT_SOFT = rgb(0.9, 0.95, 0.92);
export const BAD = rgb(0.68, 0.16, 0.16);

export type Ink = typeof INK;
export type Fonts = { regular: PDFFont; bold: PDFFont };

export type SchoolBranding = {
  name: string;
  short_name?: string | null;
  address: string | null;
  office_phone: string | null;
  email?: string | null;
};

/**
 * The embedded family, read from disk once per process.
 *
 * `next.config.ts` lists this directory in `outputFileTracingIncludes` so a
 * deployment carries the files; without that, the route would build fine and
 * then fail at the first request with ENOENT.
 */
const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;

export function fontBytes(): { regular: Uint8Array; bold: Uint8Array } {
  if (!fontCache) {
    fontCache = {
      regular: new Uint8Array(readFileSync(join(FONT_DIR, "NotoSansBengali-Regular.ttf"))),
      bold: new Uint8Array(readFileSync(join(FONT_DIR, "NotoSansBengali-Bold.ttf"))),
    };
  }
  return fontCache;
}

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const bytes = fontBytes();
  return {
    // Subsetting keeps only the glyphs actually used, so a document stays small
    // even though each source face is 141 KB.
    regular: await doc.embedFont(bytes.regular, { subset: true }),
    bold: await doc.embedFont(bytes.bold, { subset: true }),
  };
}

/**
 * Counts characters the embedded font has no glyph for.
 *
 * An earlier version substituted everything outside WinAnsi with `?`, because
 * the standard fonts could not represent Bengali at all. With a real Unicode
 * font embedded there is nothing to substitute, so this only reports genuine
 * coverage gaps — some other script pasted into a subject name — and the text
 * is drawn exactly as given.
 *
 * Measured per character rather than per string: fontkit throws on the whole
 * run if any part is uncovered, so a string-level check could not say how much
 * was lost.
 */
export function unsupported(text: string, font: PDFFont): number {
  let missing = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 && ch !== " ") {
      missing += 1;
      continue;
    }
    try {
      font.widthOfTextAtSize(ch, 10);
    } catch {
      missing += 1;
    }
  }
  return missing;
}

/** Draws text as given, returning the count of characters the font lacks. */
export function drawText(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color?: Ink },
): number {
  const missing = unsupported(text, opts.font);
  page.drawText(text, {
    x: opts.x,
    y: opts.y,
    size: opts.size,
    font: opts.font,
    color: opts.color ?? INK,
  });
  return missing;
}

/**
 * Truncates to fit a column, adding an ellipsis when it does not.
 *
 * Returns the dropped-glyph count as well as the text. An earlier version
 * returned only the string, so by the time drawText saw it every unsupported
 * character had already become "?" and the glyph counter reported zero — which
 * made the Bangla warning useless in exactly the cells that carry subject and
 * teacher names.
 */
export function fit(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): { text: string; dropped: number } {
  const dropped = unsupported(text, font);

  if (font.widthOfTextAtSize(text, size) <= maxWidth) return { text, dropped };

  /*
   * Truncate by CODE POINTS, not UTF-16 units.
   *
   * `String.slice` would happily cut through a surrogate pair or, worse,
   * between a Bengali consonant and the virama that binds it to the next one —
   * turning a conjunct into two unrelated letters rather than shortening the
   * word. Spreading into an array iterates code points.
   */
  let cut = [...text];
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut.join("")}...`, size) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return { text: `${cut.join("")}...`, dropped };
}

/** Draws text right-aligned to `x`, returning dropped glyphs. */
export function drawRight(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color?: Ink },
): number {
  const width = opts.font.widthOfTextAtSize(text, opts.size);
  return drawText(page, text, { ...opts, x: opts.x - width });
}

/** Draws text centred on `x`, returning dropped glyphs. */
export function drawCentred(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color?: Ink },
): number {
  const width = opts.font.widthOfTextAtSize(text, opts.size);
  return drawText(page, text, { ...opts, x: opts.x - width / 2 });
}

/**
 * Shared A4 page header: school name, contact line, document title, period.
 *
 * Returns the dropped-glyph count alongside the new y position. An earlier
 * version returned only y and discarded the count, which meant a Bangla school
 * NAME would silently print as question marks with no warning — the same bug
 * the fit() helper had.
 */
export function drawHeader(
  page: PDFPage,
  fonts: Fonts,
  school: SchoolBranding,
  title: string,
  subtitle: string,
): { y: number; dropped: number } {
  let dropped = 0;
  let y = A4.height - MARGIN;

  dropped += drawText(page, school.name, {
    x: MARGIN, y: y - 14, size: 15, font: fonts.bold,
  });

  const contact = [school.address, school.office_phone, school.email]
    .filter(Boolean)
    .join("  ·  ");
  if (contact) {
    dropped += drawText(page, contact, {
      x: MARGIN, y: y - 28, size: 7.5, font: fonts.regular, color: MUTED,
    });
  }

  dropped += drawText(page, title, {
    x: MARGIN, y: y - 48, size: 11, font: fonts.bold,
  });
  dropped += drawText(page, subtitle, {
    x: MARGIN, y: y - 61, size: 8, font: fonts.regular, color: MUTED,
  });

  y -= 70;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 1,
    color: INK,
  });

  return { y: y - 12, dropped };
}

/** Footer: generation timestamp and page number. */
export function drawFooter(
  page: PDFPage,
  fonts: Fonts,
  generatedAt: string,
  pageNo: number,
  pageCount: number,
) {
  drawText(page, `Generated ${generatedAt}`, {
    x: MARGIN, y: MARGIN - 14, size: 7, font: fonts.regular, color: MUTED,
  });
  const label = `Page ${pageNo} of ${pageCount}`;
  const width = fonts.regular.widthOfTextAtSize(label, 7);
  drawText(page, label, {
    x: A4.width - MARGIN - width, y: MARGIN - 14, size: 7,
    font: fonts.regular, color: MUTED,
  });
}

/** "19 October 2026" from a YYYY-MM-DD string, or a dash. */
export function prettyDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "09:15" from a Postgres time value. */
export function hhmm(time: string | null | undefined): string {
  if (!time) return "—";
  return time.slice(0, 5);
}

export { PDFDocument, rgb };
export type { PDFFont, PDFPage };
