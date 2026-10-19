import type { Metadata } from "next";
import Link from "next/link";
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
        <header className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            We will send a code to the phone number on record
          </p>
        </header>

        <div
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--border-subtle)", background: "var(--surface-raised)" }}
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
