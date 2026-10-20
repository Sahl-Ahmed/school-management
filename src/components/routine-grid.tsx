import { Status } from "@/components/ui";

/**
 * The weekly routine as a grid: weekdays down, periods across.
 *
 * Shared by the authority editor, the teacher's own timetable, the student's
 * published routine, and the printable A4 sheets, so all four show the same
 * shape and a change lands everywhere at once.
 *
 * Weekdays follow the Postgres dow convention (0 = Sunday), and only the days
 * the school actually runs are rendered — in Bangladesh the week is Sunday to
 * Thursday, so printing Friday and Saturday columns would waste a third of an
 * A4 sheet on empty cells.
 */

export const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type RoutineCell = {
  id: string;
  weekday: number;
  period_no: number;
  starts_at: string;
  ends_at: string;
  subject_name: string;
  teacher_name: string;
  section_label?: string;
  effective_to: string | null;
};

/** 09:45:00 -> 09:45 */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

/**
 * Period columns, derived from the data rather than assumed.
 *
 * Different classes genuinely run different numbers of periods, and a fixed
 * eight-column grid would print mostly empty for Play and Nursery.
 */
function periodColumns(cells: RoutineCell[]): { period_no: number; label: string }[] {
  const byPeriod = new Map<number, RoutineCell>();
  for (const c of cells) {
    const existing = byPeriod.get(c.period_no);
    // Keep the earliest start seen for this period number, for the time label.
    if (!existing || c.starts_at < existing.starts_at) byPeriod.set(c.period_no, c);
  }

  return [...byPeriod.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([period_no, cell]) => ({
      period_no,
      label: `${hhmm(cell.starts_at)}–${hhmm(cell.ends_at)}`,
    }));
}

export function RoutineGrid({
  cells,
  weekdays,
  showSection = false,
  compact = false,
  emptyMessage = "No periods scheduled yet.",
}: {
  cells: RoutineCell[];
  /** Teaching days, Postgres dow. Non-teaching days are omitted entirely. */
  weekdays: number[];
  showSection?: boolean;
  compact?: boolean;
  emptyMessage?: string;
}) {
  if (cells.length === 0) {
    return (
      <p
        className="px-4 py-8 text-center text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        {emptyMessage}
      </p>
    );
  }

  const columns = periodColumns(cells);

  // weekday -> period_no -> cells (several when a section shares a period slot)
  const lookup = new Map<string, RoutineCell[]>();
  for (const c of cells) {
    const key = `${c.weekday}:${c.period_no}`;
    const list = lookup.get(key) ?? [];
    list.push(c);
    lookup.set(key, list);
  }

  return (
    <div className="scroll-soft overflow-x-auto">
      <table
        className="w-full border-collapse text-left"
        style={{ fontSize: compact ? "0.6875rem" : "0.8125rem" }}
      >
        <caption className="sr-only">
          Weekly routine by day and period
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="whitespace-nowrap px-2 py-2 font-semibold"
              style={{
                borderBottom: "1px solid var(--line-strong)",
                background: "var(--surface-sunken)",
              }}
            >
              Day
            </th>
            {columns.map((col) => (
              <th
                key={col.period_no}
                scope="col"
                className="whitespace-nowrap px-2 py-2 font-semibold"
                style={{
                  borderBottom: "1px solid var(--line-strong)",
                  borderLeft: "1px solid var(--line-on-white)",
                  background: "var(--surface-sunken)",
                }}
              >
                <span className="block">Period {col.period_no}</span>
                <span
                  className="numeric block font-normal"
                  style={{ color: "var(--text-muted)" }}
                >
                  {col.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekdays.map((day) => (
            <tr key={day} className="avoid-break">
              <th
                scope="row"
                className="whitespace-nowrap px-2 py-2 align-top font-medium"
                style={{
                  borderBottom: "1px solid var(--line-on-white)",
                  background: "var(--surface-sunken)",
                }}
              >
                {compact ? WEEKDAY_SHORT[day] : WEEKDAY_NAMES[day]}
              </th>

              {columns.map((col) => {
                const found = lookup.get(`${day}:${col.period_no}`) ?? [];

                return (
                  <td
                    key={col.period_no}
                    className="px-2 py-2 align-top"
                    style={{
                      borderBottom: "1px solid var(--line-on-white)",
                      borderLeft: "1px solid var(--line-on-white)",
                    }}
                  >
                    {found.length === 0 ? (
                      // An explicit dash, not an empty cell: a blank reads as
                      // "data missing" rather than "no lesson".
                      <span aria-label="No lesson" style={{ color: "var(--line-strong)" }}>
                        —
                      </span>
                    ) : (
                      <ul className="space-y-1.5">
                        {found.map((cell) => (
                          <li key={cell.id}>
                            <span className="block font-medium">{cell.subject_name}</span>
                            <span className="block" style={{ color: "var(--text-secondary)" }}>
                              {cell.teacher_name}
                            </span>
                            {showSection && cell.section_label && (
                              <span
                                className="block text-[0.95em]"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {cell.section_label}
                              </span>
                            )}
                            {cell.effective_to && (
                              <span className="no-print mt-0.5 inline-block">
                                <Status tone="warn">until {cell.effective_to}</Status>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
