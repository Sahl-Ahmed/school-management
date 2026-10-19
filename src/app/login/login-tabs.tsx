"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  signInAuthority,
  signInStudent,
  signInTeacher,
  type LoginState,
} from "./actions";

type Portal = "student" | "teacher" | "authority";

const TABS: { id: Portal; label: string }[] = [
  { id: "student", label: "Student" },
  { id: "teacher", label: "Teacher" },
  { id: "authority", label: "Authority" },
];

const initialState: LoginState = {};

export function LoginTabs() {
  const [active, setActive] = useState<Portal>("student");

  return (
    <div
      className="overflow-hidden rounded-xl border shadow-sm"
      style={{ borderColor: "var(--border-subtle)", background: "var(--surface-raised)" }}
    >
      <div
        role="tablist"
        aria-label="Choose your portal"
        className="grid grid-cols-3 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActive(tab.id)}
            className="px-3 py-3 text-sm font-medium transition-colors"
            style={{
              color: active === tab.id ? "var(--color-brand-700)" : "var(--text-muted)",
              background:
                active === tab.id ? "var(--color-brand-50)" : "transparent",
              boxShadow:
                active === tab.id
                  ? "inset 0 -2px 0 0 var(--color-brand-600)"
                  : undefined,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-5">
        {active === "student" && <StudentForm />}
        {active === "teacher" && <TeacherForm />}
        {active === "authority" && <AuthorityForm />}
      </div>
    </div>
  );
}

function StudentForm() {
  const [state, action, pending] = useActionState(signInStudent, initialState);

  return (
    <form action={action} className="space-y-4" id="panel-student" role="tabpanel"
          aria-labelledby="tab-student">
      <Field
        label="Registration number"
        name="registrationNo"
        autoComplete="username"
        placeholder="STU-2026-0001"
        hint="Printed on your ID card. Not your phone number."
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormError error={state.error} />
      <SubmitButton pending={pending} />
      <Link
        href="/forgot-password?role=student"
        className="block text-center text-xs underline"
        style={{ color: "var(--text-muted)" }}
      >
        Forgot password? Verify with the phone on record.
      </Link>
    </form>
  );
}

function TeacherForm() {
  const [state, action, pending] = useActionState(signInTeacher, initialState);

  return (
    <form action={action} className="space-y-4" id="panel-teacher" role="tabpanel"
          aria-labelledby="tab-teacher">
      <Field
        label="Employee code"
        name="employeeCode"
        autoComplete="username"
        placeholder="T-001"
        hint="Issued by the school office."
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormError error={state.error} />
      <SubmitButton pending={pending} />
      <Link
        href="/forgot-password?role=teacher"
        className="block text-center text-xs underline"
        style={{ color: "var(--text-muted)" }}
      >
        Forgot password? Verify with your registered phone.
      </Link>
    </form>
  );
}

function AuthorityForm() {
  const [state, action, pending] = useActionState(signInAuthority, initialState);

  return (
    <form action={action} className="space-y-4" id="panel-authority" role="tabpanel"
          aria-labelledby="tab-authority">
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        placeholder="office@school.example"
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormError error={state.error} />
      <SubmitButton pending={pending} />
    </form>
  );
}

// ---------------------------------------------------------------------------

function Field({
  label,
  name,
  hint,
  type = "text",
  ...rest
}: {
  label: string;
  name: string;
  hint?: string;
  type?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${name}-hint` : undefined;

  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        aria-describedby={hintId}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none
                   focus-visible:ring-2 focus-visible:ring-offset-1"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--surface)",
          color: "var(--text-primary)",
        }}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function FormError({ error }: { error?: string }) {
  if (!error) return null;

  return (
    <p
      role="alert"
      className="rounded-lg px-3 py-2 text-sm"
      style={{ background: "oklch(0.96 0.03 25)", color: "oklch(0.42 0.15 25)" }}
    >
      {error}
    </p>
  );
}

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white
                 transition-opacity disabled:opacity-60"
      style={{ background: "var(--color-brand-600)" }}
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}
