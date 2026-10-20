"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Banner, Field, SubmitButton } from "@/components/form";
import { Icon, type IconName } from "@/components/icon";
import {
  signInAuthority,
  signInStudent,
  signInTeacher,
  type LoginState,
} from "./actions";

type Portal = "student" | "teacher" | "authority";

const TABS: { id: Portal; label: string; icon: IconName }[] = [
  { id: "student", label: "Student", icon: "profile" },
  { id: "teacher", label: "Teacher", icon: "teachers" },
  { id: "authority", label: "Office", icon: "dashboard" },
];

const initialState: LoginState = {};

/**
 * The sign-in card.
 *
 * Three portals, one card. The tab row carries an icon as well as a word
 * because this is the one screen used by people who are not yet oriented —
 * a parent signing in for their child does not know the product's vocabulary,
 * and "Office" is plainer than "Authority" for the only tab they must not pick.
 */
export function LoginTabs() {
  const [active, setActive] = useState<Portal>("student");

  return (
    <div
      className="overflow-hidden"
      style={{
        borderRadius: "var(--radius-card)",
        border: "1px solid var(--line-on-white)",
        background: "var(--surface-raised)",
        boxShadow: "var(--shadow-raised, var(--shadow-card))",
      }}
    >
      <div
        role="tablist"
        aria-label="Choose your portal"
        className="grid grid-cols-3"
        style={{ borderBottom: "1px solid var(--line-on-white)" }}
      >
        {TABS.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className="flex items-center justify-center gap-1.5 px-3 py-3.5 text-sm font-medium transition-colors"
              style={{
                color: selected ? "var(--accent)" : "var(--text-muted)",
                background: selected ? "var(--surface-accent)" : "transparent",
                boxShadow: selected ? "inset 0 -2px 0 0 var(--accent)" : undefined,
              }}
            >
              <Icon name={tab.icon} size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="p-5 sm:p-6">
        {active === "student" && <StudentForm />}
        {active === "teacher" && <TeacherForm />}
        {active === "authority" && <AuthorityForm />}
      </div>
    </div>
  );
}

function StudentForm() {
  const [state, action] = useActionState(signInStudent, initialState);

  return (
    <form
      action={action}
      className="space-y-4"
      id="panel-student"
      role="tabpanel"
      aria-labelledby="tab-student"
    >
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
      {state.error && <Banner tone="error">{state.error}</Banner>}
      <SubmitButton full pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
      <Link
        href="/forgot-password?role=student"
        className="block text-center text-xs underline"
        style={{ color: "var(--text-muted)" }}
      >
        Forgotten your password? Verify with the phone on record.
      </Link>
    </form>
  );
}

function TeacherForm() {
  const [state, action] = useActionState(signInTeacher, initialState);

  return (
    <form
      action={action}
      className="space-y-4"
      id="panel-teacher"
      role="tabpanel"
      aria-labelledby="tab-teacher"
    >
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
      {state.error && <Banner tone="error">{state.error}</Banner>}
      <SubmitButton full pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
      <Link
        href="/forgot-password?role=teacher"
        className="block text-center text-xs underline"
        style={{ color: "var(--text-muted)" }}
      >
        Forgotten your password? Verify with your registered phone.
      </Link>
    </form>
  );
}

function AuthorityForm() {
  const [state, action] = useActionState(signInAuthority, initialState);

  return (
    <form
      action={action}
      className="space-y-4"
      id="panel-authority"
      role="tabpanel"
      aria-labelledby="tab-authority"
    >
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
      {state.error && <Banner tone="error">{state.error}</Banner>}
      <SubmitButton full pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
