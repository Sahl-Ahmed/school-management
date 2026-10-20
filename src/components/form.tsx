"use client";

import { useFormStatus } from "react-dom";
import { Icon, type IconName } from "@/components/icon";

/**
 * Form primitives, shared by every form in the product.
 *
 * Each field renders its own error from the server action's fieldErrors, wired
 * through aria-describedby and aria-invalid so a screen reader announces the
 * problem rather than leaving a silently red border.
 *
 * Two rules the redesign added and that the rest of the product now depends on:
 *
 *   * A VALIDATION MESSAGE SAYS WHAT TO DO. "Invalid" tells a clerk nothing.
 *     The messages come from the server actions, which were already written
 *     this way; what was missing was somewhere consistent to put them, and an
 *     icon so an error is not carried by colour alone.
 *   * A FORM IN FLIGHT SAYS SO. Every submit button reads its own form's
 *     pending state, disables, and changes its label — so a slow network
 *     cannot produce a second submission or a frozen-looking page.
 */

type FieldErrors = Record<string, string[]> | undefined;

const CONTROL_CLASS =
  "w-full rounded-[var(--radius-control)] border px-3 py-2.5 text-sm outline-none transition-colors";

function controlStyle(hasError: boolean): React.CSSProperties {
  return {
    borderColor: hasError ? "var(--state-bad)" : "var(--line-strong)",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
  };
}

/** The label, with its required marker and the hint beneath. */
function Label({
  htmlFor,
  label,
  required,
}: {
  htmlFor: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
      {label}
      {required && (
        <>
          <span aria-hidden="true" className="ml-0.5" style={{ color: "var(--state-bad)" }}>
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      )}
    </label>
  );
}

/**
 * A field's hint or error.
 *
 * One component for both, so an error always replaces its hint rather than
 * stacking under it — two lines of small text, one of them red, is how a form
 * starts looking broken even when only one field is wrong.
 */
function FieldFoot({
  hintId,
  errorId,
  hint,
  error,
}: {
  hintId?: string;
  errorId?: string;
  hint?: React.ReactNode;
  error?: string;
}) {
  if (error) {
    return (
      <p
        id={errorId}
        className="mt-1.5 flex items-start gap-1 text-xs"
        style={{ color: "var(--state-bad)" }}
      >
        <span aria-hidden="true" className="mt-px shrink-0">
          <Icon name="close" size={13} />
        </span>
        <span>{error}</span>
      </p>
    );
  }

  if (hint) {
    return (
      <p id={hintId} className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {hint}
      </p>
    );
  }

  return null;
}

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
  hint?: React.ReactNode;
  type?: string;
  required?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const fieldError = errors?.[name]?.[0];
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = fieldError ? `${name}-error` : undefined;

  return (
    <div>
      <Label htmlFor={name} label={label} required={required} />
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={CONTROL_CLASS}
        style={controlStyle(Boolean(fieldError))}
        {...rest}
      />
      <FieldFoot hintId={hintId} errorId={errorId} hint={hint} error={fieldError} />
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
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldError = errors?.[name]?.[0];
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = fieldError ? `${name}-error` : undefined;

  return (
    <div>
      <Label htmlFor={name} label={label} required={required} />
      <select
        id={name}
        name={name}
        required={required}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={CONTROL_CLASS}
        style={controlStyle(Boolean(fieldError))}
        {...rest}
      >
        {children}
      </select>
      <FieldFoot hintId={hintId} errorId={errorId} hint={hint} error={fieldError} />
    </div>
  );
}

/** A multi-line field, for comments and reasons. */
export function TextareaField({
  label,
  name,
  errors,
  hint,
  required,
  rows = 3,
  ...rest
}: {
  label: string;
  name: string;
  errors?: FieldErrors;
  hint?: React.ReactNode;
  required?: boolean;
  rows?: number;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const fieldError = errors?.[name]?.[0];
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = fieldError ? `${name}-error` : undefined;

  return (
    <div>
      <Label htmlFor={name} label={label} required={required} />
      <textarea
        id={name}
        name={name}
        rows={rows}
        required={required}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={CONTROL_CLASS}
        style={controlStyle(Boolean(fieldError))}
        {...rest}
      />
      <FieldFoot hintId={hintId} errorId={errorId} hint={hint} error={fieldError} />
    </div>
  );
}

/**
 * A checkbox with its explanation.
 *
 * The label and the description are both clickable, because a 16px box is a
 * poor target on a phone and the sentence beside it is the real affordance.
 */
export function CheckboxField({
  name,
  label,
  hint,
  defaultChecked,
  checked,
  onChange,
}: {
  name?: string;
  label: string;
  hint?: React.ReactNode;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 shrink-0"
        style={{ accentColor: "var(--accent)" }}
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * A message above or inside a form.
 *
 * Carries an icon as well as colour: an office printing a screenshot in
 * monochrome, or a reader with colour-blindness, gets nothing from a red tint
 * alone. `role="alert"` on errors so they are announced immediately.
 */
export function Banner({
  tone,
  children,
}: {
  tone: "error" | "success" | "warning" | "info";
  children: React.ReactNode;
}) {
  const palette = {
    error: { bg: "var(--state-bad-soft)", fg: "var(--state-bad)", icon: "close" as IconName },
    success: { bg: "var(--state-good-soft)", fg: "var(--state-good)", icon: "check" as IconName },
    warning: { bg: "var(--state-warn-soft)", fg: "var(--state-warn)", icon: "bell" as IconName },
    info: { bg: "var(--state-info-soft)", fg: "var(--state-info)", icon: "feedback" as IconName },
  }[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="flex items-start gap-2.5 px-4 py-3 text-sm leading-relaxed"
      style={{
        borderRadius: "var(--radius-control)",
        background: palette.bg,
        color: palette.fg,
      }}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        <Icon name={palette.icon} size={16} />
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/**
 * The submit button.
 *
 * Reads the enclosing form's state through useFormStatus, so it disables itself
 * during submission without the parent threading a flag down — and so two
 * buttons in two forms on one page each reflect only their own.
 */
export function SubmitButton({
  children = "Save",
  pendingLabel = "Saving…",
  tone = "primary",
  icon,
  full = false,
}: {
  children?: React.ReactNode;
  pendingLabel?: string;
  tone?: "primary" | "secondary" | "danger";
  icon?: IconName;
  full?: boolean;
}) {
  const { pending } = useFormStatus();

  const style: React.CSSProperties =
    tone === "primary"
      ? { background: "var(--accent)", color: "#ffffff", border: "1px solid var(--accent)" }
      : tone === "danger"
        ? {
            // Outlined, never solid: see the note in globals.css about the
            // brand being a dark red.
            background: "var(--surface-raised)",
            color: "var(--state-bad)",
            border: "1px solid var(--state-bad)",
          }
        : {
            background: "var(--surface-raised)",
            color: "var(--text-primary)",
            border: "1px solid var(--line-strong)",
          };

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-60 ${
        full ? "w-full" : ""
      }`}
      style={style}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel}
        </>
      ) : (
        <>
          {icon && <Icon name={icon} size={16} />}
          {children}
        </>
      )}
    </button>
  );
}

/** A small inline spinner, for a button that is working. */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="motion-safe:animate-spin"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * A grouped set of fields.
 *
 * The legend and the description sit outside the grid so a two-column field
 * layout does not push the explanation into a column of its own.
 */
export function Fieldset({
  legend,
  description,
  columns = 2,
  children,
}: {
  legend: string;
  description?: React.ReactNode;
  columns?: 1 | 2 | 3;
  children: React.ReactNode;
}) {
  const grid = columns === 1 ? "" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";

  return (
    <fieldset
      className="rounded-[var(--radius-card)] border p-5"
      style={{ borderColor: "var(--line-on-white)", background: "var(--surface-raised)" }}
    >
      <legend className="px-2 text-sm font-semibold">{legend}</legend>
      {description && (
        <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
      )}
      <div className={`grid gap-4 ${grid}`}>{children}</div>
    </fieldset>
  );
}

/**
 * A search box that submits on enter.
 *
 * A form rather than live filtering, so the result is a shareable URL and the
 * page stays a Server Component — and so a slow connection does not re-query on
 * every keystroke.
 */
export function SearchField({
  name = "q",
  defaultValue = "",
  placeholder,
  label,
  hidden,
}: {
  name?: string;
  defaultValue?: string;
  placeholder: string;
  label: string;
  /** Other query parameters to preserve when searching. */
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form role="search" className="flex w-full gap-2 sm:w-auto">
      {Object.entries(hidden ?? {}).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}

      <label htmlFor={name} className="sr-only">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="search"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-[var(--radius-control)] border px-3 py-2 text-sm sm:w-64 sm:flex-none"
        style={{ borderColor: "var(--line-strong)", background: "var(--surface-raised)" }}
      />
      <button
        type="submit"
        className="shrink-0 rounded-[var(--radius-control)] border px-3 py-2 text-sm font-medium"
        style={{ borderColor: "var(--line-strong)", background: "var(--surface-raised)" }}
      >
        Search
      </button>
    </form>
  );
}
