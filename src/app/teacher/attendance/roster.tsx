"use client";

import { useActionState, useState } from "react";
import { submitAttendance, type AttendanceState } from "./actions";
import { Banner, SubmitButton } from "@/components/form";
import { Status } from "@/components/ui";
import type { Tone } from "@/components/charts";

export type RosterStudent = {
  id: string;
  roll_no: number;
  full_name: string;
  registration_no: string;
  current_status: string | null;
  current_remark: string | null;
};

const STATUSES: { value: string; label: string; short: string; tone: Tone }[] = [
  { value: "present", label: "Present", short: "P", tone: "good" },
  { value: "absent", label: "Absent", short: "A", tone: "bad" },
  { value: "late", label: "Late", short: "L", tone: "warn" },
  { value: "excused", label: "Excused", short: "E", tone: "neutral" },
];

const TONE_VAR: Record<Tone, string> = {
  good: "var(--state-good)",
  warn: "var(--state-warn)",
  bad: "var(--state-bad)",
  neutral: "var(--state-neutral)",
  accent: "var(--accent)",
  info: "var(--state-info)",
};

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
  const progress = students.length > 0 ? (markedCount / students.length) * 100 : 0;

  // A per-status tally, so the teacher can check the shape of what they are
  // about to submit without counting rows. Reading "28 present, 2 absent"
  // catches a mis-tap that "30 of 30 marked" cannot.
  const tally = STATUSES.map((s) => ({
    ...s,
    count: students.filter((st) => marks[st.id] === s.value).length,
  })).filter((s) => s.count > 0);

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
      className="overflow-hidden"
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-on-white)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <input type="hidden" name="routine_period_id" value={routinePeriodId} />
      <input type="hidden" name="session_date" value={sessionDate} />
      <input type="hidden" name="roster_size" value={students.length} />
      <input type="hidden" name="entries" value={entriesJson} />

      <header style={{ borderBottom: "1px solid var(--line-on-white)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{lessonLabel}</h2>
            <p className="numeric mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {markedCount} of {students.length} marked
              {tally.length > 0 && (
                <>
                  {" · "}
                  {tally.map((t) => `${t.count} ${t.label.toLowerCase()}`).join(", ")}
                </>
              )}
            </p>
          </div>

          {isCorrection ? (
            <Status tone="good">submitted</Status>
          ) : (
            <Status tone="warn" dot>
              not submitted
            </Status>
          )}
        </div>

        {/* How far through the roster the teacher is. The figure above is the
            real statement; this is only the glance. */}
        <div
          aria-hidden="true"
          className="h-1 w-full"
          style={{ background: "var(--surface-sunken)" }}
        >
          <div
            className="h-full transition-all"
            style={{
              width: `${progress}%`,
              background: markedCount === students.length ? "var(--state-good)" : "var(--accent)",
            }}
          />
        </div>
      </header>

      <div className="space-y-3 p-5">
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
          <div
            className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-xs"
            style={{
              borderRadius: "var(--radius-control)",
              background: "var(--surface-sunken)",
            }}
          >
            <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
              Mark everyone
            </span>
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setAll(s.value)}
                className="px-2.5 py-1 font-medium transition-colors"
                style={{
                  borderRadius: "var(--radius-data)",
                  border: "1px solid var(--line-strong)",
                  background: "var(--surface-raised)",
                  color: TONE_VAR[s.tone],
                }}
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMarks({})}
              className="px-2.5 py-1 font-medium transition-colors"
              style={{
                borderRadius: "var(--radius-data)",
                border: "1px solid var(--line-strong)",
                background: "var(--surface-raised)",
                color: "var(--text-muted)",
              }}
            >
              Clear
            </button>
          </div>
        )}

        <ul className="divide-y" style={{ borderColor: "var(--line-on-white)" }}>
          {students.map((s) => {
            const chosen = marks[s.id];
            return (
              <li key={s.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span
                    className="numeric grid h-8 w-8 shrink-0 place-items-center text-sm font-semibold"
                    style={{
                      borderRadius: "var(--radius-data)",
                      background: "var(--surface-sunken)",
                      color: "var(--text-secondary)",
                    }}
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

                  {/*
                   * The chosen status is coloured by its own meaning, not by
                   * the brand: present is green, absent is red. Colouring every
                   * selection maroon made "Absent" and "Present" look identical
                   * once chosen, which on a roster of forty is a real error.
                   */}
                  <fieldset className="flex shrink-0 flex-wrap gap-1" disabled={disabled}>
                    <legend className="sr-only">
                      Attendance for {s.full_name}, roll {s.roll_no}
                    </legend>
                    {STATUSES.map((opt) => {
                      const checked = chosen === opt.value;
                      return (
                        <label
                          key={opt.value}
                          /* A finger needs a target, so the compact letters
                             get height and a minimum width on a phone; the
                             worded version on a wider screen needs neither. */
                          className="inline-flex min-w-9 cursor-pointer select-none items-center justify-center px-2.5 py-2.5 text-xs font-medium transition-colors sm:min-w-0 sm:py-1.5"
                          style={{
                            borderRadius: "var(--radius-data)",
                            border: `1px solid ${checked ? TONE_VAR[opt.tone] : "var(--line-strong)"}`,
                            background: checked ? TONE_VAR[opt.tone] : "transparent",
                            color: checked ? "#fff" : "var(--text-secondary)",
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
                          <span className="hidden sm:inline">{opt.label}</span>
                          <span className="sm:hidden" aria-hidden="true">
                            {opt.short}
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                </div>

                {/* A remark is where "left early, parent informed" goes. Shown
                    only once a status is chosen, to keep the roster scannable. */}
                {chosen && chosen !== "present" && (
                  <input
                    type="text"
                    value={remarks[s.id] ?? ""}
                    onChange={(e) =>
                      setRemarks((r) => ({ ...r, [s.id]: e.target.value }))
                    }
                    placeholder="Optional note, for example: left early, guardian informed"
                    maxLength={200}
                    aria-label={`Note for ${s.full_name}`}
                    className="mt-2.5 w-full px-3 py-2 text-xs"
                    style={{
                      borderRadius: "var(--radius-control)",
                      border: "1px solid var(--line-strong)",
                      background: "var(--surface)",
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>

        {isCorrection && (
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">
              Reason for the correction
              <span
                aria-hidden="true"
                className="ml-0.5"
                style={{ color: "var(--state-bad)" }}
              >
                *
              </span>
            </span>
            <input
              type="text"
              name="reason"
              required
              maxLength={500}
              placeholder="For example: marked absent in error, parent confirmed attendance"
              className="w-full px-3 py-2.5 text-sm"
              style={{
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--line-strong)",
                background: "var(--surface-raised)",
              }}
            />
          </label>
        )}
      </div>

      {/*
       * The submit stays in reach on a phone.
       *
       * A roster of forty is taller than the screen, and a teacher who has
       * finished marking should not have to scroll to the end to submit. The
       * bar sticks to the bottom of the viewport while the form is on screen.
       */}
      <div
        className="sticky bottom-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
        style={{
          borderTop: "1px solid var(--line-on-white)",
          background: "color-mix(in srgb, var(--surface-raised) 92%, transparent)",
          backdropFilter: "saturate(180%) blur(8px)",
        }}
      >
        <SubmitButton pendingLabel="Submitting…">
          {isCorrection ? "Save correction" : "Submit attendance"}
        </SubmitButton>

        <p className="w-full text-xs leading-relaxed sm:w-auto sm:min-w-0 sm:flex-1" style={{ color: "var(--text-muted)" }}>
          Leaving this unsubmitted is not the same as marking everyone absent. An
          unsubmitted lesson is excluded from every attendance percentage.
        </p>
      </div>
    </form>
  );
}
