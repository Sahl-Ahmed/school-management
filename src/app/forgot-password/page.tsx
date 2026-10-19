import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Forgot password" };

/**
 * Password recovery landing page. The OTP-based reset flow is phase 2; this
 * page exists so the links on the sign-in form go somewhere truthful rather
 * than 404-ing, and it states plainly that the flow is not live yet.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;
  const identifier =
    role === "teacher" ? "employee code" : "registration number";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div
        className="w-full max-w-md rounded-xl border p-6"
        style={{ borderColor: "var(--border-subtle)", background: "var(--surface-raised)" }}
      >
        <h1 className="text-lg font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Recovery will ask for your {identifier}, send a one-time code to the
          verified phone number on record, and let you set a new password.
        </p>
        <p
          className="mt-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--color-brand-50)", color: "var(--color-brand-900)" }}
        >
          This flow is built in phase 2 and is not available yet. Please contact
          the school office to have your password reset.
        </p>
        <Link
          href="/login"
          className="mt-5 block rounded-lg border px-4 py-2 text-center text-sm font-medium"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
