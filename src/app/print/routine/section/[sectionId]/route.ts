import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadRoutine } from "@/lib/school/routine-data";
import { buildSectionRoutinePdf } from "@/lib/pdf/routine";
import { schoolToday, longDate } from "@/lib/school/calendar";

/**
 * One class/section routine as a downloadable A4 PDF.
 *
 * Open to any signed-in user, because the data is loaded under the caller's own
 * permissions: a student requesting another class's routine gets a PDF with no
 * periods in it, since RLS returns them nothing. That is why the empty case is
 * reported as 404 rather than 403 — from the caller's side the two are
 * indistinguishable, and saying "forbidden" would confirm the section exists.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sectionId: string }> },
) {
  const { sectionId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });

  const today = schoolToday();
  const data = await loadRoutine(today, sectionId);

  if (!data) {
    return new NextResponse("No academic year is marked as current", { status: 409 });
  }

  const section = data.sections[0];
  if (!section) {
    return new NextResponse("No routine is available for that class", { status: 404 });
  }

  const { bytes, droppedGlyphs } = await buildSectionRoutinePdf(
    data.school,
    section,
    data.teachingDays,
    data.academicYear,
    longDate(today),
  );

  const slug = `${section.class_name}-${section.section_name || "A"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="routine-${slug}-${today}.pdf"`,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "no-store",
  });

  if (droppedGlyphs > 0) {
    headers.set("X-Pdf-Dropped-Glyphs", String(droppedGlyphs));
  }

  return new NextResponse(bytes as BodyInit, { headers });
}
