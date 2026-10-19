import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadRoutine } from "@/lib/school/routine-data";
import { buildSchoolRoutinePdf } from "@/lib/pdf/routine";
import { schoolToday, longDate } from "@/lib/school/calendar";

/**
 * The combined school-wide routine as a downloadable A4 PDF.
 *
 * Authority only: the school-wide view aggregates every class, which is not a
 * teacher's or a student's business. The data itself is also read under the
 * caller's own permissions, so this check is defence in depth rather than the
 * only guard.
 */
export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();

  if (!profile || !["authority_admin", "authority_staff"].includes(profile.role)) {
    return new NextResponse("Only the school office can download the school-wide routine", {
      status: 403,
    });
  }

  const today = schoolToday();
  const data = await loadRoutine(today);

  if (!data) {
    return new NextResponse("No academic year is marked as current", { status: 409 });
  }

  const { bytes, droppedGlyphs } = await buildSchoolRoutinePdf(
    data.school,
    data.sections,
    data.teachingDays,
    data.academicYear,
    longDate(today),
  );

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="school-routine-${today}.pdf"`,
    "Content-Length": String(bytes.byteLength),
    // Always current: a routine change must not be served from a cache.
    "Cache-Control": "no-store",
  });

  // Surfaced rather than hidden: the standard PDF fonts cannot encode Bangla,
  // so a caller can tell the user their PDF lost glyphs.
  if (droppedGlyphs > 0) {
    headers.set("X-Pdf-Dropped-Glyphs", String(droppedGlyphs));
  }

  return new NextResponse(bytes as BodyInit, { headers });
}
