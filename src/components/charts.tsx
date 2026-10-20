/**
 * Chart primitives.
 *
 * Pure SVG with no client JavaScript, so these render in Server Components and
 * print correctly. Rules enforced here rather than left to each call site, per
 * docs/design-system.md:
 *
 *   * Every chart carries its DENOMINATOR and PERIOD. A bare "87%" is not
 *     acceptable — the brief is explicit that context-free or invented figures
 *     must not be displayed. These components require the denominator as a
 *     prop, so a caller cannot omit it.
 *   * A ring states its figure numerically in the centre, because a ring alone
 *     cannot be read precisely.
 *   * Colour is never the only carrier of meaning: every coloured element is
 *     paired with a label and a value, so the chart survives colour-blindness
 *     and a monochrome print.
 *   * When there is no data, these say so rather than drawing an empty 0%,
 *     which would read as a real measurement of zero.
 */

import { Icon, type IconName } from "@/components/icon";

export type Tone = "good" | "warn" | "bad" | "neutral" | "accent" | "info";

const TONE_VAR: Record<Tone, string> = {
  good: "var(--state-good)",
  warn: "var(--state-warn)",
  bad: "var(--state-bad)",
  neutral: "var(--state-neutral)",
  accent: "var(--accent)",
  info: "var(--state-info)",
};

const TONE_SOFT: Record<Tone, string> = {
  good: "var(--state-good-soft)",
  warn: "var(--state-warn-soft)",
  bad: "var(--state-bad-soft)",
  neutral: "var(--state-neutral-soft)",
  accent: "var(--accent-soft)",
  info: "var(--state-info-soft)",
};

/**
 * The series palette, for a chart with several unrelated categories.
 *
 * Six colours, every one of which clears WCAG AA as a fill under white text AND
 * as text on either surface — so a bar can be labelled inside itself or beside
 * itself without a second decision. Defined in globals.css.
 *
 * Used where the categories carry no good/bad meaning, such as students per
 * class. Where they DO carry meaning, use the tones instead: a reader should
 * never have to learn that purple means "late".
 */
export const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const;

/**
 * Picks a tone from an attendance-style percentage.
 *
 * Thresholds are presentation only; no business rule depends on them.
 *
 * The 75–89 band is INFO (a steel blue), not the brand maroon. Maroon now means
 * "the button you press", and reusing it for a middling attendance figure would
 * teach the reader that the brand colour means "adequate" — which then makes
 * every primary button look like a lukewarm score.
 */
export function percentageTone(pct: number): Tone {
  if (pct >= 90) return "good";
  if (pct >= 75) return "info";
  if (pct >= 60) return "warn";
  return "bad";
}

// ---------------------------------------------------------------------------

/**
 * Circular percentage meter.
 *
 * `denominator` is required and rendered, so the ring can never show a
 * percentage whose basis is invisible. When `denominator` is 0 the ring renders
 * as "no data" rather than 0%.
 */
export function RingMeter({
  value,
  denominator,
  label,
  period,
  size = 112,
  tone,
  unit = "%",
}: {
  /** The numerator, e.g. periods attended. */
  value: number;
  /** The basis, e.g. periods actually submitted. Required by design. */
  denominator: number;
  label: string;
  /** The window the figure covers, e.g. "May 2026". */
  period?: string;
  size?: number;
  tone?: Tone;
  unit?: string;
}) {
  const hasData = denominator > 0;
  const pct = hasData ? Math.round((value / denominator) * 1000) / 10 : 0;
  const resolvedTone = tone ?? (hasData ? percentageTone(pct) : "neutral");

  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = hasData ? (pct / 100) * circumference : 0;

  return (
    <figure className="flex items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={
          hasData
            ? `${label}: ${pct}% — ${value} of ${denominator}${period ? `, ${period}` : ""}`
            : `${label}: no data recorded${period ? ` for ${period}` : ""}`
        }
        className="shrink-0"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-sunken)"
          strokeWidth={stroke}
        />
        {/* A zero-length arc with a round cap still paints a dot at twelve
            o’clock, which reads as "a little bit" rather than as nothing. */}
        {hasData && dash > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={TONE_VAR[resolvedTone]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            // Start at twelve o'clock rather than three.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
        {/* The figure in the centre: a ring alone cannot be read precisely. */}
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="numeric"
          style={{
            fontSize: size * 0.23,
            fontWeight: 600,
            fill: "var(--text-primary)",
          }}
        >
          {hasData ? `${pct}${unit}` : "—"}
        </text>
      </svg>

      <figcaption className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hasData ? (
          <p className="numeric mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {value} of {denominator}
          </p>
        ) : (
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            No data recorded
          </p>
        )}
        {period && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {period}
          </p>
        )}
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------

export type BarDatum = {
  label: string;
  value: number;
  tone?: Tone;
  /** Shown instead of the raw value, e.g. "12 (40%)". */
  display?: string;
};

/**
 * Horizontal bars.
 *
 * Scaled against the largest value rather than an arbitrary maximum, with each
 * bar's value printed beside it. `total` is required and shown as the
 * denominator so the reader knows what the bars are a share of.
 */
export function BarSeries({
  data,
  total,
  caption,
  period,
  emptyMessage = "Nothing recorded yet",
}: {
  data: BarDatum[];
  /** The basis for these bars, printed as the denominator. */
  total: number;
  caption: string;
  period?: string;
  emptyMessage?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);

  /*
   * Whether there is data depends on the DENOMINATOR, not on the bar values.
   *
   * Keying this off `max > 0` meant a student who was absent in every
   * submitted lesson saw "No attendance submitted this month yet" above a
   * table showing one submitted lesson — the chart contradicted the figures
   * beside it. All-zero bars are a real measurement and must render as such.
   */
  const hasData = total > 0 && data.length > 0;

  return (
    <figure>
      <figcaption className="mb-3">
        <p className="text-sm font-medium">{caption}</p>
        <p className="numeric mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {hasData ? `out of ${total}` : emptyMessage}
          {period && hasData && ` · ${period}`}
        </p>
      </figcaption>

      {hasData && (
        <ul className="space-y-2">
          {data.map((d) => {
            // A zero value renders as an empty track with its value printed,
            // not as a missing row.
            const width = max > 0 ? (d.value / max) * 100 : 0;
            const tone = d.tone ?? "accent";
            return (
              <li key={d.label} className="flex items-center gap-3 text-xs">
                <span className="w-20 shrink-0 truncate" title={d.label}>
                  {d.label}
                </span>
                <span
                  className="h-4 min-w-px flex-1 overflow-hidden"
                  style={{
                    borderRadius: "var(--radius-data)",
                    background: "var(--surface-sunken)",
                  }}
                >
                  <span
                    className="block h-full"
                    style={{
                      width: `${width}%`,
                      background: TONE_VAR[tone],
                      borderRadius: "var(--radius-data)",
                    }}
                  />
                </span>
                {/* The value is always printed, so colour is not load-bearing. */}
                <span className="numeric w-16 shrink-0 text-right font-medium">
                  {d.display ?? d.value}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------

/**
 * A single figure with its context.
 *
 * `detail` is required: a number without a basis is exactly what the brief
 * forbids, so the type makes the caller supply one.
 */
export function StatCard({
  label,
  value,
  detail,
  tone = "accent",
  icon,
}: {
  label: string;
  value: string | number;
  /**
   * The figure's basis. Required by design: a number without one is exactly
   * what the brief forbids, so the type makes the caller supply it.
   */
  detail: string;
  tone?: Tone;
  icon?: IconName;
}) {
  return (
    <div
      className="relative overflow-hidden p-4 sm:p-5"
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-on-white)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-muted)" }}>
          {label}
        </p>
        {/* A small tinted square instead of a full-bleed accent rule: it codes
            the figure's kind without the card becoming a coloured block, which
            is what made a row of four of these read as a traffic light. */}
        {icon && (
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-data)]"
            style={{ background: TONE_SOFT[tone], color: TONE_VAR[tone] }}
          >
            <Icon name={icon} size={16} />
          </span>
        )}
      </div>

      <p className="numeric mt-2 text-2xl font-semibold leading-none tracking-tight sm:text-3xl">
        {value}
      </p>

      <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {detail}
      </p>
    </div>
  );
}

