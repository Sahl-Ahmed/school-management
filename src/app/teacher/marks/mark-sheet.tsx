"use client";

import { useActionState, useMemo, useState } from "react";
import { submitMarks, type MarksState } from "./actions";
import { Banner, SubmitButton } from "@/components/form";
import { Status } from "@/components/ui";

export type MarkRow = {
  student_id: string;
  roll_no: number;
  full_name: string;
  registration_no: string;
  current_marks: string | null;
  current_absent: boolean;
};

const initial: MarksState = {};

export function MarkSheet({
  examSubjectId,
  sectionId,
  label,
  maxMarks,
  passMarks,
  students,
  alreadySubmitted,
  entryOpen,
}: {
  examSubjectId: string;
  sectionId: string;
  label: string;
  maxMarks: number;
  passMarks: number | null;
  students: MarkRow[];
  alreadySubmitted: boolean;
  entryOpen: boolean;
}) {
  const [state, action] = useActionState(submitMarks, initial);

  /*
   * Marks and absences live in state and are submitted through ONE hidden
   * field. React 19 resets a form once a Server Action completes, which would
   * otherwise wipe a mark sheet the teacher had just filled in when a
   * submission was rejected — and a retry would then send nothing.
   */
  const [marks, setMarks] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      students
        .filter((s) => s.current_marks !== null)
        .map((s) => [s.student_id, s.current_marks!]),
    ),
  );
  const [absent, setAbsent] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      students.filter((s) => s.current_absent).map((s) => [s.student_id, true]),
    ),
  );

  const entries = useMemo(
    () =>
      students
        .filter((s) => absent[s.student_id] || marks[s.student_id] !== undefined)
        .filter((s) => absent[s.student_id] || marks[s.student_id] !== "")
        .map((s) => ({
          student_id: s.student_id,
          marks: absent[s.student_id] ? null : Number(marks[s.student_id]),
          absent: Boolean(absent[s.student_id]),
        })),
    [students, marks, absent],
  );

  const entered = entries.length;
  const overMax = entries.filter((e) => e.marks !== null && e.marks > maxMarks).length;
  const progress = students.length > 0 ? (entered / students.length) * 100 : 0;

  return (
    <form
      action={action}
      className="overflow-hidden"
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-on-white)",
        boxShadow: "var(--shadow-card)",
        display: "block",
      }}
    >
      <input type="hidden" name="exam_subject_id" value={examSubjectId} />
      <input type="hidden" name="section_id" value={sectionId} />
      <input type="hidden" name="roster_size" value={students.length} />
      <input type="hidden" name="entries" value={JSON.stringify(entries)} />

      <header style={{ borderBottom: "1px solid var(--line-on-white)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{label}</h2>
            <p className="numeric mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              out of {maxMarks}
              {passMarks !== null && ` · pass mark ${passMarks}`}
              {` · ${entered} of ${students.length} entered`}
            </p>
          </div>
          {alreadySubmitted ? (
            <Status tone="good">submitted</Status>
          ) : (
            <Status tone="warn" dot>
              not submitted
            </Status>
          )}
        </div>

        <div
          aria-hidden="true"
          className="h-1 w-full"
          style={{ background: "var(--surface-sunken)" }}
        >
          <div
            className="h-full transition-all"
            style={{
              width: `${progress}%`,
              background: entered === students.length ? "var(--state-good)" : "var(--accent)",
            }}
          />
        </div>
      </header>

      <div className="space-y-3 p-5">
        {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
        {state.error && <Banner tone="error">{state.error}</Banner>}

        {!entryOpen && (
          <Banner tone="info">
            Mark entry is not open for this exam. The school office controls
            when it opens and closes.
          </Banner>
        )}

        {alreadySubmitted && entryOpen && !state.ok && (
          <Banner tone="info">
            These marks were already submitted. Changing them is a correction
            and needs a reason, which is recorded in the audit log.
          </Banner>
        )}

        {overMax > 0 && (
          <Banner tone="error">
            {overMax} mark{overMax === 1 ? " is" : "s are"} above the maximum of {maxMarks}.
          </Banner>
        )}

        <ul className="divide-y" style={{ borderColor: "var(--line-on-white)" }}>
          {students.map((s) => {
            const isAbsent = Boolean(absent[s.student_id]);
            const value = marks[s.student_id] ?? "";
            const numeric = Number(value);
            const over = value !== "" && numeric > maxMarks;
            const failing =
              !isAbsent && value !== "" && passMarks !== null && numeric < passMarks;

            return (
              <li key={s.student_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
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
                  <span className="numeric block text-xs" style={{ color: "var(--text-muted)" }}>
                    {s.registration_no}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  <label className="sr-only" htmlFor={`mark-${s.student_id}`}>
                    Marks for {s.full_name}, out of {maxMarks}
                  </label>
                  <input
                    id={`mark-${s.student_id}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={maxMarks}
                    step="0.5"
                    disabled={!entryOpen || isAbsent}
                    value={isAbsent ? "" : value}
                    onChange={(e) =>
                      setMarks((m) => ({ ...m, [s.student_id]: e.target.value }))
                    }
                    className="numeric w-20 px-2.5 py-2 text-right text-sm font-medium"
                    style={{
                      borderRadius: "var(--radius-control)",
                      border: `1px solid ${over ? "var(--state-bad)" : "var(--line-strong)"}`,
                      background: isAbsent ? "var(--surface-sunken)" : "var(--surface-raised)",
                    }}
                  />

                  {/* Absent is explicit, never inferred from a blank box — a
                      blank means "not entered yet", which is different. */}
                  <label className="flex cursor-pointer items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={isAbsent}
                      disabled={!entryOpen}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setAbsent((a) => ({ ...a, [s.student_id]: next }));
                        if (next) {
                          setMarks((m) => {
                            const copy = { ...m };
                            delete copy[s.student_id];
                            return copy;
                          });
                        }
                      }}
                    />
                    Absent
                  </label>

                  <span className="w-24 shrink-0 text-right">
                    {isAbsent && <Status tone="neutral">absent</Status>}
                    {!isAbsent && failing && <Status tone="bad">below pass</Status>}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {alreadySubmitted && entryOpen && (
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
              placeholder="For example: addition error on question 4"
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

      {entryOpen && (
        /* The submit stays in reach: a sheet of forty is taller than the
           screen, and the teacher should not have to scroll to the end. */
        <div
          className="sticky bottom-0 flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
          style={{
            borderTop: "1px solid var(--line-on-white)",
            background: "color-mix(in srgb, var(--surface-raised) 92%, transparent)",
            backdropFilter: "saturate(180%) blur(8px)",
          }}
        >
          <SubmitButton pendingLabel="Submitting…">
            {alreadySubmitted ? "Save correction" : "Submit marks"}
          </SubmitButton>
          <p
            className="w-full text-xs leading-relaxed sm:w-auto sm:min-w-0 sm:flex-1"
            style={{ color: "var(--text-muted)" }}
          >
            Marks stay private until the school publishes the results. Nothing
            here is visible to students.
          </p>
        </div>
      )}
    </form>
  );
}
