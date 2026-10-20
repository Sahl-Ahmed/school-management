/**
 * Readable text on an author-chosen background.
 *
 * The authority picks a library card's colour; the system picks the text
 * colour. That split is the point of the revised card specification: an
 * unreadable combination should be impossible rather than discouraged, so the
 * text is DERIVED from the background by relative luminance and never stored.
 *
 * Deliberately free of server-only imports: the colour picker previews a card
 * in the browser and the card renders on the server, and both must reach the
 * same answer.
 */

export type Readable = {
  /** The background, normalised to #rrggbb. */
  background: string;
  /** Black or white, whichever reads better on it. */
  text: string;
  /** A muted version of the text colour, for the secondary line. */
  textMuted: string;
  /** Contrast ratio of `text` on `background`, 1–21. */
  ratio: number;
  /** True when the pair clears WCAG AA for body text. */
  meetsAA: boolean;
  /** True when it clears AA for large text only. */
  meetsLargeAA: boolean;
};

const BLACK = "#121712";
const WHITE = "#ffffff";

/** The project's default card colour, from the green ramp in globals.css. */
export const DEFAULT_CARD_COLOR = "#1f6b45";

/**
 * A curated set that fits the white/green/black palette.
 *
 * Offered as buttons, with a free picker behind them: most of the time the
 * office wants a colour that looks like it belongs, and picking from eight
 * that do is faster and safer than reaching for a colour wheel.
 */
export const CARD_COLOR_PRESETS: { value: string; name: string }[] = [
  { value: "#1f6b45", name: "School green" },
  { value: "#14532d", name: "Deep green" },
  { value: "#3f6212", name: "Olive" },
  { value: "#155e75", name: "Teal" },
  { value: "#1e3a5f", name: "Slate blue" },
  { value: "#7c2d12", name: "Clay" },
  { value: "#4c1d95", name: "Plum" },
  { value: "#1f2937", name: "Charcoal" },
  { value: "#d9f2e4", name: "Pale green" },
  { value: "#fef3c7", name: "Sand" },
  { value: "#e0e7ff", name: "Pale indigo" },
  { value: "#f3f4f6", name: "Light grey" },
];

/** Parses #rgb or #rrggbb into 0–255 components, or null. */
export function parseHex(color: string): [number, number, number] | null {
  const value = color.trim().replace(/^#/, "");

  if (/^[0-9a-f]{3}$/i.test(value)) {
    const [r, g, b] = [...value].map((c) => parseInt(c + c, 16));
    return [r!, g!, b!];
  }
  if (/^[0-9a-f]{6}$/i.test(value)) {
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  }
  return null;
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance, per WCAG 2.1. */
export function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1–21. */
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Moves a colour towards black or white by `amount` (0–1). */
function shade(rgb: [number, number, number], amount: number, towardsWhite: boolean): [number, number, number] {
  const target = towardsWhite ? 255 : 0;
  return rgb.map((c) => c + (target - c) * amount) as [number, number, number];
}

/**
 * Picks readable text for a background, darkening or lightening the background
 * if neither black nor white can reach AA on it.
 *
 * The specification asks for exactly this: "If a chosen colour cannot reach AA
 * with either black or white, adjust the shade and say so rather than shipping
 * grey-on-grey." Mid-tone colours — a medium green, a medium blue — are the
 * ones that fail, and they are common choices, so this is not a rare path.
 *
 * `meetsAA` reports the final state, so a caller can tell the office that its
 * colour was nudged.
 */
export function readableOn(color: string | null | undefined): Readable {
  const parsed = parseHex(color ?? "") ?? parseHex(DEFAULT_CARD_COLOR)!;

  const pick = (rgb: [number, number, number]) => {
    const onBlack = contrastRatio(rgb, parseHex(BLACK)!);
    const onWhite = contrastRatio(rgb, parseHex(WHITE)!);
    return onBlack >= onWhite
      ? { text: BLACK, ratio: onBlack, dark: true }
      : { text: WHITE, ratio: onWhite, dark: false };
  };

  let rgb = parsed;
  let best = pick(rgb);

  /*
   * Nudge the background until AA is reachable.
   *
   * Which way to nudge follows from which text colour is already winning: if
   * black reads better, the background is lightish, so lighten it further.
   * Ten steps of 6% is enough to rescue any mid-tone without turning the
   * office's choice into a different colour altogether.
   */
  for (let step = 0; step < 10 && best.ratio < 4.5; step++) {
    rgb = shade(rgb, 0.06, best.dark);
    best = pick(rgb);
  }

  const background = toHex(rgb);
  const textRgb = parseHex(best.text)!;

  return {
    background,
    text: best.text,
    /*
     * A muted secondary line: the text colour moved 28% TOWARDS THE
     * BACKGROUND, so it stays in the same family while reading as subordinate.
     *
     * The direction is `best.dark`, not its negation: when the text is dark the
     * background is light, so muting means moving towards white. Getting this
     * backwards made white text mute to white — identical to the primary — and
     * the two lines rendered with no distinction at all.
     */
    textMuted: toHex(shade(textRgb, 0.28, best.dark)),
    ratio: Math.round(best.ratio * 100) / 100,
    meetsAA: best.ratio >= 4.5,
    meetsLargeAA: best.ratio >= 3,
  };
}

/** True when a string is a colour this module can use. */
export function isHexColor(value: string): boolean {
  return parseHex(value) !== null;
}

/** Normalises any accepted colour form to #rrggbb, or null. */
export function normaliseHex(value: string): string | null {
  const parsed = parseHex(value);
  return parsed ? toHex(parsed) : null;
}
