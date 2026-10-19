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

export type Tone = "good" | "warn" | "bad" | "neutral" | "accent";

const TONE_VAR: Record<Tone, string> = {
  good: "var(--state-good)",
  warn: "var(--state-warn)",
  bad: "var(--state-bad)",
  neutral: "var(--state-neutral)",
  accent: "var(--accent)",
};

const TONE_SOFT: Record<Tone, string> = {
  good: "var(--state-good-soft)",
  warn: "var(--state-warn-soft)",
  bad: "var(--state-bad-soft)",
  neutral: "var(--state-neutral-soft)",
  accent: "var(--accent-soft)",
};

/**
 * Picks a tone from an attendance-style percentage.
 * Thresholds are presentation only; no business rule depends on them.
 */
export function percentageTone(pct: number): Tone {
  if (pct >= 90) return "good";
  if (pct >= 75) return "accent";
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
        {hasData && (
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
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: Tone;
}) {
  return (
    <div
      className="relative overflow-hidden p-4 pl-5"
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-hairline)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* A left accent rule instead of a coloured card: keeps the surface white
          and still codes the figure's kind at a glance. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: TONE_VAR[tone] }}
      />
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="numeric mt-1 text-2xl font-semibold leading-none">{value}</p>
      <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
        {detail}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A small coloured status pill. Always carries text, never colour alone. */
export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap px-2 py-0.5 text-xs font-medium"
      style={{
        borderRadius: "var(--radius-data)",
        background: TONE_SOFT[tone],
        color: TONE_VAR[tone],
      }}
    >
      {children}
    </span>
  );
}
