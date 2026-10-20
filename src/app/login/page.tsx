import type { Metadata } from "next";
import { Banner } from "@/components/form";
import { Icon } from "@/components/icon";
import { LoginTabs } from "./login-tabs";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The sign-in screen.
 *
 * A two-panel layout from `lg` upwards: the identity panel on the maroon, the
 * form on the cream. Below `lg` the panel is dropped entirely and the form gets
 * the whole screen, because on a phone the only thing that matters is the
 * keyboard reaching the fields.
 *
 * The panel deliberately does NOT name the school. Nothing about the school is
 * readable before sign-in: `school_settings` is `select ... to authenticated`,
 * and the only public route to the school's name is `get_public_card`, which
 * answers for one issued card at a time. Printing the name here would mean
 * widening anonymous read access, which is the owner's decision to make and not
 * a thing to slip into a redesign.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-[1fr_minmax(26rem,34rem)]">
      {/* The identity panel. Hidden on a phone. */}
      <aside
        className="on-accent relative hidden flex-col justify-between p-10 lg:flex"
        style={{ background: "var(--accent)" }}
      >
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 place-items-center rounded-[var(--radius-control)]"
            style={{ background: "rgb(255 255 255 / 0.14)" }}
          >
            <Icon name="dashboard" size={20} />
          </span>
          <span className="text-sm font-semibold">School management</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            One record, three portals
          </h1>
          <p className="mt-5 text-sm leading-relaxed" style={{ opacity: 0.86 }}>
            Attendance, results, fees and school documents. Students and
            guardians see what concerns them, teachers see their own classes, and
            the office sees the school.
          </p>

          <ul className="mt-8 space-y-3 text-sm" style={{ opacity: 0.9 }}>
            {[
              ["check", "Attendance counted only from lessons a teacher submitted"],
              ["chart", "Results private until the school publishes them"],
              ["card", "ID and admit cards printed at card size"],
            ].map(([icon, text]) => (
              <li key={text} className="flex items-start gap-2.5">
                <span aria-hidden="true" className="mt-0.5 shrink-0">
                  <Icon name={icon as "check"} size={16} />
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs" style={{ opacity: 0.7 }}>
          Accounts are created by the school office.
        </p>
      </aside>

      {/* The form column. */}
      <div className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <header className="mb-7 flex items-center gap-2.5 lg:hidden">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)]"
              style={{ background: "var(--accent)", color: "var(--text-on-accent)" }}
            >
              <Icon name="dashboard" size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold">Sign in</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Choose your portal below
              </p>
            </div>
          </header>

          <header className="mb-6 hidden lg:block">
            <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              Choose your portal and sign in with what the office gave you.
            </p>
          </header>

          {error === "account_inactive" && (
            <div className="mb-4">
              <Banner tone="error">
                This account is not active, so it cannot be signed into. The
                school office can reactivate it.
              </Banner>
            </div>
          )}

          <LoginTabs />

          <p
            className="mt-6 text-center text-xs leading-relaxed"
            style={{ color: "var(--text-muted)" }}
          >
            If you have not signed in before, use the activation link sent to
            your registered phone.
          </p>
        </div>
      </div>
    </main>
  );
}
