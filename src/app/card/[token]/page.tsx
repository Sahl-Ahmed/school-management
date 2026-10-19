import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The public digital ID card.
 *
 * Reached by scanning the QR code printed on a physical card. It is read-only
 * and signs nobody in.
 *
 * Everything shown comes from a single RPC, `get_public_card`, which returns a
 * frozen snapshot of the fields printed on that card plus the school's own
 * contact details. This page performs no query against students, enrollments,
 * contacts, fees, marks or attendance — so there is no join here that a future
 * change could widen. Parent names, NIDs and the birth certificate number are
 * excluded at the database level by a trigger on qr_tokens, not merely omitted
 * from this template.
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

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <article
        className="w-full max-w-sm overflow-hidden rounded-2xl border shadow-sm"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--surface-raised)",
        }}
      >
        <header
          className="flex items-center gap-3 px-5 py-4"
          style={{ background: "var(--color-brand-600)" }}
        >
          <div>
            <p className="text-sm font-semibold text-white">{school.name}</p>
            <p className="text-xs text-white/80">Student Identity Card</p>
          </div>
        </header>

        <div className="space-y-4 px-5 py-5">
          {typeof card.full_name === "string" && (
            <div>
              <h1 className="text-lg font-semibold leading-tight">{card.full_name}</h1>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <CardField label="Registration No" value={card.registration_no} mono />
            <CardField label="Roll" value={card.roll_no} mono />
            <CardField label="Class" value={card.class_name} />
            <CardField label="Section" value={card.section_name} />
            <CardField label="Blood Group" value={card.blood_group} />
            <CardField label="Session" value={card.session} />
            {/* A contact number appears only when the printed card template
                deliberately includes one. */}
            <CardField label="Contact" value={card.contact_phone} mono />
          </dl>
        </div>

        <footer
          className="border-t px-5 py-4 text-xs"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
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

function CardField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  // Fields the card template did not print simply do not appear.
  if (value === null || value === undefined || value === "") return null;

  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
      <dd className={`font-medium ${mono ? "numeric" : ""}`}>{value}</dd>
    </div>
  );
}
