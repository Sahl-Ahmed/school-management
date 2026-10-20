import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicCardFields } from "@/lib/school/card-fields";
import { brandingUrl } from "@/lib/school/branding";

/**
 * The public digital ID card.
 *
 * Reached by scanning the QR code printed on a physical card. It is read-only
 * and signs nobody in.
 *
 * Everything shown comes from a single RPC, `get_public_card`, which returns a
 * frozen snapshot of the fields printed on that card plus the school's own
 * name, logo, email and office number. This page performs no query against
 * students, enrollments, contacts, fees, marks or attendance — so there is no
 * join here that a future change could widen. Parent names, NIDs and the birth
 * certificate number are excluded at the database level by a trigger on
 * qr_tokens, not merely omitted from this template.
 *
 * What it shows is decided by src/lib/school/card-fields.ts, the same list the
 * card template draws from. The owner's rule is that **the page shows the same
 * student details the card prints** — so a contact number printed on the card
 * is visible to anyone who scans it, by deliberate choice, and a field left off
 * the card is nowhere. Keeping the list in one module is what stopped the two
 * drifting apart: the page previously looked for a key nothing wrote, and
 * silently dropped a field the card printed.
 */

export const metadata: Metadata = {
  title: "Digital ID Card",
  robots: { index: false, follow: false },
};

// The card reflects a revocation immediately, so it is never cached.
export const dynamic = "force-dynamic";

type PublicCard = {
  card: Record<string, string | number | null>;
  school: {
    name: string;
    logo_path: string | null;
    email: string | null;
    office_phone: string | null;
  };
  issued_at: string;
};

export default async function PublicCardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_public_card", { p_token: token });

  // A revoked or unknown token resolves to null. Both render as "not found":
  // telling a visitor that a card was revoked rather than never existing would
  // confirm the token was once valid.
  if (error || !data) notFound();

  const payload = data as PublicCard;
  const { card, school } = payload;

  const fields = publicCardFields(card);
  const headings = fields.filter((f) => f.heading);
  const details = fields.filter((f) => !f.heading);
  const logo = brandingUrl(school.logo_path);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <article
        className="w-full max-w-sm overflow-hidden rounded-2xl border shadow-sm"
        style={{
          borderColor: "var(--line-strong)",
          background: "var(--surface-raised)",
        }}
      >
        <header
          className="flex items-center gap-3 px-5 py-4"
          style={{ background: "var(--accent)" }}
        >
          {/* The logo is served from the public `branding` bucket. Absent until
              the school supplies one, which is why its absence is a non-event
              rather than a broken image. */}
          {logo && (
            <Image
              src={logo}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded bg-white/90 object-contain p-0.5"
              unoptimized
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{school.name}</p>
            <p className="text-xs text-white/80">Student Identity Card</p>
          </div>
        </header>

        <div className="space-y-4 px-5 py-5">
          {headings.map((f) => (
            <h1
              key={f.key}
              className={
                f.key === "full_name"
                  ? "text-lg font-semibold leading-tight"
                  : "text-base font-medium leading-tight"
              }
              style={f.key === "full_name" ? undefined : { color: "var(--text-secondary)" }}
            >
              {f.value}
            </h1>
          ))}

          {details.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {details.map((f) => (
                <div key={f.key}>
                  <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {f.label}
                  </dt>
                  <dd className={`font-medium ${f.numeric ? "numeric" : ""}`}>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <footer
          className="border-t px-5 py-4 text-xs"
          style={{ borderColor: "var(--line-strong)", color: "var(--text-muted)" }}
        >
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>
            {school.name}
          </p>
          {school.email && <p>{school.email}</p>}
          {school.office_phone && <p className="numeric">{school.office_phone}</p>}
          <p className="mt-2">
            This is a read-only identity card. It does not grant access to any
            student account.
          </p>
        </footer>
      </article>
    </main>
  );
}
