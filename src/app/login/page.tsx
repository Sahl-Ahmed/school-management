import type { Metadata } from "next";
import { LoginTabs } from "./login-tabs";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">School</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Sign in to your portal
          </p>
        </header>

        {error === "account_inactive" && (
          <p
            role="alert"
            className="mb-4 rounded-lg border px-3 py-2 text-sm"
            style={{
              borderColor: "oklch(0.8 0.12 25)",
              background: "oklch(0.97 0.03 25)",
              color: "oklch(0.4 0.14 25)",
            }}
          >
            This account is not active. Please contact the school office.
          </p>
        )}

        <LoginTabs />

        <p className="mt-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Accounts are created by the school office. If you have not signed in
          before, use the activation link sent to your registered phone.
        </p>
      </div>
    </main>
  );
}
