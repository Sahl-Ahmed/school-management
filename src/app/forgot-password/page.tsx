import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ActivationFlow } from "@/app/activate/activation-flow";

export const metadata: Metadata = { title: "Forgot password" };
export const dynamic = "force-dynamic";

/**
 * Password recovery. Same three steps as activation — identify, verify a code
 * sent to the phone on record, choose a password — and the same component, so
 * the two flows cannot drift apart in how they handle rate limits or errors.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;
  const defaultRole = role === "teacher" ? "teacher" : "student";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <header className="mb-6">
          <span
            aria-hidden="true"
            className="mb-3 grid h-11 w-11 place-items-center rounded-[var(--radius-control)]"
            style={{ background: "var(--accent)", color: "var(--text-on-accent)" }}
          >
            <Icon name="profile" size={20} />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            We will send a code to the phone number the school has on record. The
            code is a development simulation until an SMS provider is connected,
            so it is shown on screen rather than delivered.
          </p>
        </header>

        <div
          className="p-5 sm:p-6"
          style={{
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--line-on-white)",
            background: "var(--surface-raised)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <ActivationFlow purpose="password_reset" defaultRole={defaultRole} />
        </div>

        <Link
          href="/login"
          className="mt-4 block text-center text-sm underline"
          style={{ color: "var(--text-muted)" }}
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
