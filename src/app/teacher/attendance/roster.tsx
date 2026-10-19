"use client";

import { useActionState, useState } from "react";
import { submitAttendance, type AttendanceState } from "./actions";
import { Banner, SubmitButton } from "@/components/form";
import { Pill } from "@/components/charts";

export type RosterStudent = {
  id: string;
  roll_no: number;
  full_name: string;
  registration_no: string;
  current_status: string | null;
  current_remark: string | null;
};

const STATUSES = [
  { value: "present", label: "Present", tone: "good" as const },
  { value: "absent", label: "Absent", tone: "bad" as const },
  { value: "late", label: "Late", tone: "warn" as const },
  { value: "excused", label: "Excused", tone: "neutral" as const },
];

const initial: AttendanceState = {};

export function AttendanceRoster({
  routinePeriodId,
  sessionDate,
  lessonLabel,
  students,
  alreadySubmittedAt,
  disabled,
}: {
  routinePeriodId: string;
  sessionDate: string;
  lessonLabel: string;
  students: RosterStudent[];
  alreadySubmittedAt: string | null;
  disabled: boolean;
}) {
  const [state, action] = useActionState(submitAttendance, initial);

  /*
   * Marks and remarks live in state, and are submitted through ONE hidden
   * field rather than as individual radio inputs.
   *
   * This is not a stylistic choice. React 19 resets a form after a Server
   * Action completes, which clears every radio in the DOM. After a rejected
   * submission the teacher's marks vanished from the screen while the counter
   * still read "1 of 3 marked", and a retry submitted nothing at all — the
   * worst possible failure for an attendance roster. Serialising from state
   * makes what is submitted exactly what is displayed, independent of how the
   * browser or React treats the form element.
   */
  const [marks, setMarks] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      students.filter((s) => s.current_status).map((s) => [s.id, s.current_status!]),
    ),
  );

  const [remarks, setRemarks] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      students.filter((s) => s.current_remark).map((s) => [s.id, s.current_remark!]),
    ),
  );

  const markedCount = students.filter((s) => marks[s.id]).length;
  const isCorrection = Boolean(alreadySubmittedAt);

  const entriesJson = JSON.stringify(
    students
      .filter((s) => marks[s.id])
      .map((s) => ({
        student_id: s.id,
        status: marks[s.id],
        remark: remarks[s.id]?.trim() || undefined,
      })),
  );

  function setAll(status: string) {
    setMarks(Object.fromEntries(students.map((s) => [s.id, status])));
  }

  if (students.length === 0) {
    return (
      <Banner tone="info">
        No students are enrolled in this class for the current academic year, so
        there is no attendance to take.
      </Banner>
    );
  }

  return (
    <form
      action={action}
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-hairline)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <input type="hidden" name="routine_period_id" value={routinePeriodId} />
      <input type="hidden" name="session_date" value={sessionDate} />
      <input type="hidden" name="roster_size" value={students.length} />
      <input type="hidden" name="entries" value={entriesJson} />

      <header
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid var(--line-hairline)" }}
      >
        <div>
          <h2 className="text-sm font-semibold">{lessonLabel}</h2>
          <p className="numeric mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {markedCount} of {students.length} marked
          </p>
        </div>

        {isCorrection ? (
          <Pill tone="good">Submitted</Pill>
        ) : (
          <Pill tone="warn">Not submitted</Pill>
        )}
      </header>

      <div className="space-y-3 p-4">
        {state.ok && (
          <Banner tone="success">
            {state.correction
              ? `Attendance corrected for ${state.marked} students. The change is recorded in the audit log.`
              : `Attendance submitted for ${state.marked} students.`}
          </Banner>
        )}

        {state.error && <Banner tone="error">{state.error}</Banner>}

        {isCorrection && !state.ok && (
          <Banner tone="info">
            This lesson was already submitted. Changing it is a correction and
            needs a reason, which is recorded in the audit log.
          </Banner>
        )}

        {/* Marking thirty students one radio at a time is the common case, so
            a bulk setter comes first — but it fills the controls rather than
            submitting, so the teacher still confirms. */}
        {!disabled && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span style={{ color: "var(--text-muted)" }}>Mark everyone:</span>
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setAll(s.value)}
                className="rounded border px-2.5 py-1 font-medium"
                style={{ borderColor: "var(--line-hairline)" }}
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMarks({})}
              className="rounded border px-2.5 py-1 font-medium"
              style={{ borderColor: "var(--line-hairline)" }}
            >
              Clear
            </button>
          </div>
        )}

        <ul className="divide-y" style={{ borderColor: "var(--line-hairline)" }}>
          {students.map((s) => (
            <li key={s.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span
                  className="numeric w-8 shrink-0 text-sm font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  {s.roll_no}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.full_name}</span>
                  <span
                    className="numeric block text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {s.registration_no}
                  </span>
                </span>

                <fieldset className="flex shrink-0 flex-wrap gap-1" disabled={disabled}>
                  <legend className="sr-only">
                    Attendance for {s.full_name}, roll {s.roll_no}
                  </legend>
                  {STATUSES.map((opt) => {
                    const checked = marks[s.id] === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className="cursor-pointer select-none px-2.5 py-1 text-xs font-medium"
                        style={{
                          borderRadius: "var(--radius-data)",
                          border: `1px solid ${checked ? "var(--accent)" : "var(--line-hairline)"}`,
                          background: checked ? "var(--accent)" : "transparent",
                          color: checked ? "var(--text-on-accent)" : "var(--text-secondary)",
                        }}
                      >
                        <input
                          type="radio"
                          /* No `name`: the submitted payload comes from the
                             hidden `entries` field, so these controls only
                             drive state. */
                          value={opt.value}
                          checked={checked}
                          onChange={() =>
                            setMarks((m) => ({ ...m, [s.id]: opt.value }))
                          }
                          className="sr-only"
                        />
                        {opt.label}
                      </label>
                    );
                  })}
                </fieldset>
              </div>

              {/* A remark is where "left early, parent informed" goes. Shown
                  only once a status is chosen, to keep the roster scannable. */}
              {marks[s.id] && marks[s.id] !== "present" && (
                <input
                  type="text"
                  value={remarks[s.id] ?? ""}
                  onChange={(e) =>
                    setRemarks((r) => ({ ...r, [s.id]: e.target.value }))
                  }
                  placeholder="Optional note"
                  maxLength={200}
                  aria-label={`Note for ${s.full_name}`}
                  className="mt-2 w-full rounded border px-2 py-1 text-xs"
                  style={{
                    borderColor: "var(--line-hairline)",
                    background: "var(--surface)",
                  }}
                />
              )}
            </li>
          ))}
        </ul>

        {isCorrection && (
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">
              Reason for the correction
              <span aria-hidden="true" className="ml-0.5" style={{ color: "var(--state-bad)" }}>*</span>
            </span>
            <input
              type="text"
              name="reason"
              required
              maxLength={500}
              placeholder="For example: marked absent in error, parent confirmed attendance"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: "var(--line-hairline)",
                background: "var(--surface)",
              }}
            />
          </label>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <SubmitButton pendingLabel="Submitting…">
            {isCorrection ? "Save correction" : "Submit attendance"}
          </SubmitButton>

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Leaving this unsubmitted is not the same as marking everyone absent.
            An unsubmitted lesson is excluded from every attendance percentage.
          </p>
        </div>
      </div>
    </form>
  );
}
