import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { Icon } from "@/components/icon";
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
        <header className="mb-6">
          <span
            aria-hidden="true"
            className="mb-3 grid h-11 w-11 place-items-center rounded-[var(--radius-control)]"
            style={{ background: "var(--accent)", color: "var(--text-on-accent)" }}
          >
            <Icon name="profile" size={20} />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Activate your account</h1>
          <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Verify the phone number the school has on record, then choose your
            password. The code is a development simulation until an SMS provider
            is connected, so it is shown on screen rather than delivered.
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
          <ActivationFlow purpose="activation" />
        </div>

        {user && (
          <form action={signOut} className="mt-4">
            <button
              type="submit"
              className="w-full px-4 py-2.5 text-sm font-medium"
              style={{
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--line-strong)",
                background: "var(--surface-raised)",
                color: "var(--text-secondary)",
              }}
            >
              Sign out
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
