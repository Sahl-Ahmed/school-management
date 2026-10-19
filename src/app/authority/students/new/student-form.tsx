"use client";

import { useActionState } from "react";
import Link from "next/link";
import { admitStudent, type AdmissionState } from "./actions";
import { Field, SelectField, Banner, SubmitButton, Fieldset } from "@/components/form";
import { PhotoInput } from "@/components/photo-input";
import { BLOOD_GROUPS } from "@/lib/validation/student";

export type SectionOption = {
  id: string;
  label: string;
};

const initial: AdmissionState = {};

export function StudentForm({
  academicYearId,
  academicYearName,
  sections,
}: {
  academicYearId: string;
  academicYearName: string;
  sections: SectionOption[];
}) {
  const [state, action] = useActionState(admitStudent, initial);

  if (state.ok) {
    return (
      <div className="space-y-4">
        <Banner tone="success">
          Student admitted. Their account has been created and is waiting for
          first-login activation.
        </Banner>

        {state.warning && <Banner tone="warning">{state.warning}</Banner>}

        <Banner tone="info">
          The student activates the account themselves: they enter their
          registration number on the sign-in page, receive a code on the guardian
          phone recorded above, and choose their own password. The office never
          sets or sees that password.
        </Banner>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/authority/students/new"
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            Admit another student
          </Link>
          <Link
            href="/authority/students"
            className="rounded-lg border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--line-hairline)" }}
          >
            Back to students
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {state.error && <Banner tone="error">{state.error}</Banner>}

      <input type="hidden" name="academic_year_id" value={academicYearId} />

      <Fieldset
        legend="Identity"
        description="Printed on the ID card and the result sheet."
      >
        <Field
          label="Full name"
          name="full_name"
          errors={state.fieldErrors}
          required
          autoComplete="off"
        />
        <Field
          label="Full name (Bangla)"
          name="full_name_bn"
          errors={state.fieldErrors}
          hint="Optional"
          autoComplete="off"
        />
        <SelectField label="Gender" name="gender" errors={state.fieldErrors} required
                     defaultValue="">
          <option value="" disabled>Select…</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </SelectField>
        <Field
          label="Date of birth"
          name="date_of_birth"
          type="date"
          errors={state.fieldErrors}
          required
        />
        <SelectField label="Blood group" name="blood_group" errors={state.fieldErrors}
                     defaultValue="">
          <option value="">Not recorded</option>
          {BLOOD_GROUPS.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </SelectField>
      </Fieldset>

      <Fieldset
        legend="Enrollment"
        description={`Academic year ${academicYearName}. A roll number must be unique within its class and section for the year.`}
      >
        <Field
          label="Registration number"
          name="registration_no"
          errors={state.fieldErrors}
          hint="Permanent and unique. The student signs in with this."
          required
          autoComplete="off"
        />
        <Field
          label="Roll number"
          name="roll_no"
          type="number"
          min={1}
          errors={state.fieldErrors}
          required
        />
        <SelectField
          label="Class and section"
          name="section_id"
          errors={state.fieldErrors}
          required
          defaultValue=""
        >
          <option value="" disabled>Select…</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </SelectField>
        <Field
          label="Admission date"
          name="admitted_on"
          type="date"
          errors={state.fieldErrors}
          hint="Defaults to today"
        />
      </Fieldset>

      <Fieldset
        legend="Parents and guardian"
        description="Parent names appear on the ID card. They are never shown on the public QR page."
      >
        <Field label="Father's name" name="father_name" errors={state.fieldErrors} required />
        <Field label="Mother's name" name="mother_name" errors={state.fieldErrors} required />
        <Field
          label="Guardian phone"
          name="guardian_phone"
          type="tel"
          inputMode="tel"
          errors={state.fieldErrors}
          hint="Receives attendance and result SMS, and the activation code. Siblings may share one number."
          required
          placeholder="01712345678"
        />
        <Field
          label="Guardian name"
          name="contact_holder_name"
          errors={state.fieldErrors}
          hint="Optional — who answers this number"
        />
      </Fieldset>

      <Fieldset
        legend="Official identifiers"
        description="Stored separately from the rest of the record and readable only by the school office. Never printed on a card or shown on the QR page."
      >
        <Field
          label="Father's NID"
          name="father_nid"
          inputMode="numeric"
          errors={state.fieldErrors}
          hint="At least one parent NID is required"
        />
        <Field
          label="Mother's NID"
          name="mother_nid"
          inputMode="numeric"
          errors={state.fieldErrors}
          hint="Enter either or both"
        />
        <Field
          label="Birth certificate number"
          name="birth_certificate_no"
          errors={state.fieldErrors}
          hint="Optional"
        />
      </Fieldset>

      <Fieldset legend="Photograph">
        <PhotoInput errors={state.fieldErrors} />
      </Fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Admitting…">Admit student</SubmitButton>
        <Link
          href="/authority/students"
          className="text-sm underline"
          style={{ color: "var(--text-muted)" }}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
