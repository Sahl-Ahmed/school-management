import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { ActivationFlow } from "./activation-flow";

export const metadata: Metadata = { title: "Activate your account" };
export const dynamic = "force-dynamic";

/**
 * First-login activation.
 *
 * Reached two ways: directly by someone who has never signed in, and by the
 * proxy, which confines any account with profiles.must_set_password = true to
 * this route until activation is finished.
 */
export default async function ActivatePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Activate your account</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Verify the phone number on record and choose your password
          </p>
        </header>

        <div
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--line-hairline)", background: "var(--surface-raised)" }}
        >
          <ActivationFlow purpose="activation" />
        </div>

        {user && (
          <form action={signOut} className="mt-4">
            <button
              type="submit"
              className="w-full rounded-lg border px-4 py-2 text-sm font-medium"
              style={{ borderColor: "var(--line-hairline)" }}
            >
              Sign out
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
