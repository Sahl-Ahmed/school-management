"use client";

import { useFormStatus } from "react-dom";

/**
 * Form primitives shared by the admission forms and the activation flow.
 *
 * Each field renders its own error from the server action's fieldErrors, wired
 * through aria-describedby and aria-invalid so screen readers announce the
 * problem rather than leaving a silently red border.
 */

type FieldErrors = Record<string, string[]> | undefined;

export function Field({
  label,
  name,
  errors,
  hint,
  type = "text",
  required,
  ...rest
}: {
  label: string;
  name: string;
  errors?: FieldErrors;
  hint?: string;
  type?: string;
  required?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const fieldError = errors?.[name]?.[0];
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = fieldError ? `${name}-error` : undefined;

  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-red-600">*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none
                   focus-visible:ring-2 focus-visible:ring-offset-1"
        style={{
          borderColor: fieldError ? "var(--state-bad)" : "var(--line-hairline)",
          background: "var(--surface)",
          color: "var(--text-primary)",
        }}
        {...rest}
      />
      {hint && !fieldError && (
        <p id={hintId} className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
      {fieldError && (
        <p id={errorId} className="mt-1 text-xs" style={{ color: "var(--state-bad)" }}>
          {fieldError}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  name,
  errors,
  hint,
  required,
  children,
  ...rest
}: {
  label: string;
  name: string;
  errors?: FieldErrors;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldError = errors?.[name]?.[0];
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = fieldError ? `${name}-error` : undefined;

  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium">
        {label}
        {required && <span aria-hidden="true" className="ml-0.5 text-red-600">*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      <select
        id={name}
        name={name}
        required={required}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none
                   focus-visible:ring-2 focus-visible:ring-offset-1"
        style={{
          borderColor: fieldError ? "var(--state-bad)" : "var(--line-hairline)",
          background: "var(--surface)",
          color: "var(--text-primary)",
        }}
        {...rest}
      >
        {children}
      </select>
      {hint && !fieldError && (
        <p id={hintId} className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
      {fieldError && (
        <p id={errorId} className="mt-1 text-xs" style={{ color: "var(--state-bad)" }}>
          {fieldError}
        </p>
      )}
    </div>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: "error" | "success" | "warning" | "info";
  children: React.ReactNode;
}) {
  const palette = {
    error: { bg: "var(--state-bad-soft)", fg: "var(--state-bad)" },
    success: { bg: "var(--state-good-soft)", fg: "var(--state-good)" },
    warning: { bg: "var(--state-warn-soft)", fg: "var(--state-warn)" },
    info: { bg: "var(--surface-accent)", fg: "var(--text-primary)" },
  }[tone];

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className="rounded-lg px-3 py-2 text-sm"
      style={{ background: palette.bg, color: palette.fg }}
    >
      {children}
    </p>
  );
}

export function SubmitButton({
  children = "Save",
  pendingLabel = "Saving…",
}: {
  children?: React.ReactNode;
  pendingLabel?: string;
}) {
  // useFormStatus reads the enclosing form's state, so the button disables
  // itself during submission without the parent threading a flag down.
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg px-4 py-2.5 text-sm font-medium text-white
                 transition-opacity disabled:opacity-60"
      style={{ background: "var(--accent)" }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function Fieldset({
  legend,
  description,
  children,
}: {
  legend: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      className="rounded-xl border p-5"
      style={{ borderColor: "var(--line-hairline)", background: "var(--surface-raised)" }}
    >
      <legend className="px-2 text-sm font-semibold">{legend}</legend>
      {description && (
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
