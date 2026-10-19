"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createTeacher, type TeacherState } from "./actions";
import { Field, SelectField, Banner, SubmitButton, Fieldset } from "@/components/form";
import { BLOOD_GROUPS } from "@/lib/validation/student";
import { RECOMMENDED_FINGERS } from "@/lib/validation/teacher";

export type Option = { id: string; label: string };

type AssignmentRow = { key: number; section_id: string; subject_id: string };

const initial: TeacherState = {};

export function TeacherForm({
  academicYearId,
  sections,
  subjects,
  devices,
}: {
  academicYearId: string;
  sections: Option[];
  subjects: Option[];
  devices: Option[];
}) {
  const [state, action] = useActionState(createTeacher, initial);
  const [rows, setRows] = useState<AssignmentRow[]>([
    { key: 0, section_id: "", subject_id: "" },
  ]);

  // Serialised into one hidden field, because the row count is dynamic and a
  // single validated JSON payload beats indexed field names.
  const assignmentsJson = JSON.stringify(
    rows
      .filter((r) => r.section_id && r.subject_id)
      .map((r) => ({
        section_id: r.section_id,
        subject_id: r.subject_id,
        academic_year_id: academicYearId,
      })),
  );

  if (state.ok) {
    return (
      <div className="space-y-4">
        <Banner tone="success">
          Teacher added. Their account has been created and is waiting for
          first-login activation.
        </Banner>

        {state.fingerWarning && <Banner tone="warning">{state.fingerWarning}</Banner>}

        <Banner tone="info">
          The teacher activates the account themselves: they enter their employee
          code on the sign-in page, receive a code on their personal phone, and
          choose their own password. Fingerprint attendance at the terminal is
          separate from portal sign-in.
        </Banner>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/authority/teachers/new"
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-white"
            style={{ background: "var(--color-brand-600)" }}
          >
            Add another teacher
          </Link>
          <Link
            href="/authority/teachers"
            className="rounded-lg border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            Back to teachers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {state.error && <Banner tone="error">{state.error}</Banner>}

      <input type="hidden" name="assignments" value={assignmentsJson} />

      <Fieldset legend="Identity">
        <Field label="Full name" name="full_name" errors={state.fieldErrors} required />
        <Field
          label="Full name (Bangla)"
          name="full_name_bn"
          errors={state.fieldErrors}
          hint="Optional"
        />
        <Field
          label="Employee code"
          name="employee_code"
          errors={state.fieldErrors}
          hint="The teacher signs in with this"
          required
          placeholder="T-004"
        />
        <SelectField label="Gender" name="gender" errors={state.fieldErrors} required
                     defaultValue="">
          <option value="" disabled>Select…</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </SelectField>
        <SelectField label="Blood group" name="blood_group" errors={state.fieldErrors}
                     defaultValue="">
          <option value="">Not recorded</option>
          {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </SelectField>
        <Field label="Father's name" name="father_name" errors={state.fieldErrors} />
        <Field label="Mother's name" name="mother_name" errors={state.fieldErrors} />
      </Fieldset>

      <Fieldset
        legend="Contact"
        description="The personal phone receives the activation code and every password reset, so it must be reachable."
      >
        <Field
          label="Personal phone"
          name="personal_phone"
          type="tel"
          inputMode="tel"
          errors={state.fieldErrors}
          required
          placeholder="01712345678"
        />
        <Field
          label="Additional contact phone"
          name="alternate_phone"
          type="tel"
          inputMode="tel"
          errors={state.fieldErrors}
          hint="Optional"
        />
        <Field label="Email" name="email" type="email" errors={state.fieldErrors} hint="Optional" />
      </Fieldset>

      <Fieldset
        legend="Official identifier"
        description="Stored separately from the rest of the record and readable only by the school office."
      >
        <Field
          label="NID"
          name="nid"
          inputMode="numeric"
          errors={state.fieldErrors}
          required
        />
      </Fieldset>

      <Fieldset legend="Employment">
        <Field label="Education" name="education" errors={state.fieldErrors}
               placeholder="M.A. in Bangla" />
        <Field label="Designation" name="designation" errors={state.fieldErrors}
               placeholder="Senior Teacher" />
        <Field label="Joining date" name="joined_on" type="date" errors={state.fieldErrors} />
      </Fieldset>

      {/* Assignments are their own block because the row count varies. */}
      <fieldset
        className="rounded-xl border p-5"
        style={{ borderColor: "var(--border-subtle)", background: "var(--surface-raised)" }}
      >
        <legend className="px-2 text-sm font-semibold">Class assignments</legend>
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          These decide which students, attendance and marks this teacher can
          reach, and which feedback forms students receive about them. They can
          be left empty now and set through the routine later.
        </p>

        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={row.key} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <label
                  htmlFor={`section-${row.key}`}
                  className="mb-1 block text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  Class and section
                </label>
                <select
                  id={`section-${row.key}`}
                  value={row.section_id}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((r) => (r.key === row.key ? { ...r, section_id: e.target.value } : r)),
                    )
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--surface)" }}
                >
                  <option value="">Select…</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              <div className="min-w-[10rem] flex-1">
                <label
                  htmlFor={`subject-${row.key}`}
                  className="mb-1 block text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  Subject
                </label>
                <select
                  id={`subject-${row.key}`}
                  value={row.subject_id}
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((r) => (r.key === row.key ? { ...r, subject_id: e.target.value } : r)),
                    )
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--surface)" }}
                >
                  <option value="">Select…</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>

              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                  className="rounded-lg border px-3 py-2 text-xs"
                  style={{ borderColor: "var(--border-subtle)" }}
                  aria-label={`Remove assignment ${index + 1}`}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            setRows((rs) => [...rs, { key: Date.now(), section_id: "", subject_id: "" }])
          }
          className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          Add another assignment
        </button>
      </fieldset>

      <Fieldset
        legend="Fingerprint terminal"
        description={`Enroll the teacher's fingers at the terminal first, then record the device user ID here. Enroll ${RECOMMENDED_FINGERS} DIFFERENT fingers — scanning one finger three times enrolls one finger, not three. No fingerprint image is uploaded to this website, and this mapping alone transmits no attendance.`}
      >
        {devices.length === 0 ? (
          <p className="sm:col-span-2 text-sm" style={{ color: "var(--text-muted)" }}>
            No fingerprint terminal is registered yet, so a device mapping cannot
            be recorded. Register a device first.
          </p>
        ) : (
          <>
            <SelectField label="Terminal" name="device_id" errors={state.fieldErrors}
                         defaultValue="">
              <option value="">Not mapped yet</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </SelectField>
            <Field
              label="Device user ID"
              name="device_user_id"
              errors={state.fieldErrors}
              hint="The numeric ID shown on the terminal"
              inputMode="numeric"
            />
            <Field
              label="Distinct fingers enrolled"
              name="enrolled_fingers"
              type="number"
              min={0}
              max={10}
              defaultValue={0}
              errors={state.fieldErrors}
              hint={`Recommended minimum: ${RECOMMENDED_FINGERS}`}
            />
            <Field label="Notes" name="device_notes" errors={state.fieldErrors}
                   hint="Optional — which fingers, any issues" />
          </>
        )}
      </Fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Add teacher</SubmitButton>
        <Link href="/authority/teachers" className="text-sm underline"
              style={{ color: "var(--text-muted)" }}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
