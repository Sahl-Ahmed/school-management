import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildIdCardPdf, type IdCardFields } from "@/lib/pdf/id-card";
import { cardQrPng, cardUrl } from "@/lib/pdf/qr";
import { loadPhotoBytes, slug } from "@/lib/school/document-data";
import { publicEnv } from "@/lib/env";

/**
 * A student ID card at true PVC size — front, back, or both.
 *
 * The card prints exactly the fields the template declares, and the live QR
 * token's snapshot is what it prints them FROM. That is the point: the physical
 * card and the public page at /card/<token> are rendered from the same frozen
 * JSON, so they cannot drift apart, and a field the template does not ask for
 * exists in neither.
 *
 * A card with no issued token still prints, with an empty QR frame, because the
 * office sometimes wants to proof the layout before issuing. It says so on the
 * card rather than printing a QR that resolves to nothing.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const { studentId } = await params;
  const url = new URL(request.url);

  const sideParam = url.searchParams.get("side");
  const side = sideParam === "front" || sideParam === "back" ? sideParam : "both";
  const orientationParam = url.searchParams.get("orientation");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });

  // RLS limits qr_tokens to the office and to the student's own row, so this
  // returns nothing when the caller may not see the card.
  const { data: token } = await supabase
    .from("qr_tokens")
    .select("token, card_snapshot, template_id, document_templates(orientation, config)")
    .eq("student_id", studentId)
    .is("revoked_at", null)
    .maybeSingle();

  const { data: school } = await supabase
    .from("school_settings")
    .select("name, short_name, address, office_phone, email")
    .maybeSingle();

  if (!school) {
    return new NextResponse("School settings are not configured", { status: 409 });
  }

  // When no card has been issued, fall back to the default template so the
  // layout can still be proofed.
  let template = Array.isArray(token?.document_templates)
    ? token?.document_templates[0]
    : token?.document_templates;

  if (!template) {
    const { data: fallback } = await supabase
      .from("document_templates")
      .select("orientation, config")
      .eq("kind", "id_card")
      .eq("is_default", true)
      .maybeSingle();
    template = fallback ?? undefined;
  }

  if (!template) {
    return new NextResponse("No ID card template is configured", { status: 409 });
  }

  const config = (template.config ?? {}) as {
    front_fields?: string[];
    back_fields?: string[];
    return_note?: string;
  };

  // The office may proof the other orientation without switching the default.
  const orientation =
    orientationParam === "portrait" || orientationParam === "landscape"
      ? orientationParam
      : (template.orientation as "portrait" | "landscape");

  const snapshot = (token?.card_snapshot ?? {}) as IdCardFields & { photo_path?: string | null };

  if (!token) {
    // Nothing has been issued, so there is no snapshot to print. Rather than
    // inventing one from the student record — which would print fields the
    // public page does not have — this says plainly that a card must be issued.
    return new NextResponse(
      "No ID card has been issued for this student yet. Issue one first, " +
        "so that the printed card and the public QR page carry the same fields.",
      { status: 409 },
    );
  }

  const photo = config.front_fields?.includes("photo")
    ? await loadPhotoBytes(snapshot.photo_path ?? null)
    : null;

  const site = publicEnv().NEXT_PUBLIC_SITE_URL;
  const link = cardUrl(site, token.token);
  const qr = await cardQrPng(link);

  const { bytes, dropped } = await buildIdCardPdf(
    {
      school,
      orientation,
      frontFields: config.front_fields ?? [],
      backFields: config.back_fields ?? [],
      returnNote: config.return_note ?? "If found, please return to the school office.",
      fields: snapshot,
      photo,
      cardUrl: link,
      qr,
    },
    side,
  );

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition":
      `attachment; filename="id-card-${slug(snapshot.registration_no ?? studentId)}` +
      `-${orientation}-${side}.pdf"`,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "no-store",
  });

  if (dropped > 0) headers.set("X-Pdf-Dropped-Glyphs", String(dropped));

  return new NextResponse(bytes as BodyInit, { headers });
}
