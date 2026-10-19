import type { Metadata } from "next";
import { signOut } from "@/app/login/actions";

export const metadata: Metadata = { title: "Activate your account" };

/**
 * Account activation landing page.
 *
 * Middleware sends any account with profiles.must_set_password = true here and
 * lets it reach nothing else, so this route must exist from phase 1 even
 * though the OTP flow itself is built in phase 2.
 *
 * It deliberately does not pretend to work: there is no form here that looks
 * like it sends a code and silently does nothing.
 */
export default function ActivatePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div
        className="w-full max-w-md rounded-xl border p-6"
        style={{ borderColor: "var(--border-subtle)", background: "var(--surface-raised)" }}
      >
        <h1 className="text-lg font-semibold tracking-tight">Activate your account</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Your account has been created by the school office but has not been
          activated yet. Activation sends a one-time code to the phone number on
          record and lets you choose your own password.
        </p>
        <p
          className="mt-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--color-brand-50)", color: "var(--color-brand-900)" }}
        >
          The OTP activation flow is built in phase 2 and is not available yet.
          Until then, the school office sets initial passwords directly.
        </p>
        <form action={signOut} className="mt-5">
          <button
            type="submit"
            className="w-full rounded-lg border px-4 py-2 text-sm font-medium"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
