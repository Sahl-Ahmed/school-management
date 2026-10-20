import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildResultSheetPdf } from "@/lib/pdf/result-sheet";
import { loadResultSheets, slug } from "@/lib/school/document-data";
import { schoolToday, longDate } from "@/lib/school/calendar";

/**
 * Result sheets as a downloadable A4 PDF — one student, or a whole section.
 *
 * `result_sheet_data` reads published_results only, so an unpublished exam has
 * nothing to return and a student asking for a classmate's sheet gets an empty
 * set. Both surface here as 404: there is no state in which this route prints a
 * draft mark.
 *
 * The figures come from each result's frozen snapshot, which is why a reprint
 * months later matches the sheet the parent first received even if a mark was
 * corrected in between.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ examId: string }> },
) {
  const { examId } = await params;
  const url = new URL(request.url);
  const studentId = url.searchParams.get("student");
  const sectionId = url.searchParams.get("section");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });

  const payload = await loadResultSheets(examId, { studentId, sectionId });

  if (!payload) {
    return new NextResponse(
      "No published results are available for that exam", { status: 404 },
    );
  }

  if (payload.sheets.length === 0) {
    return new NextResponse(
      "No published result matches that student or class", { status: 404 },
    );
  }

  const { bytes, dropped, pages } = await buildResultSheetPdf({
    school: payload.school,
    exam: payload.exam,
    sheets: payload.sheets,
    generatedAt: longDate(schoolToday()),
  });

  const single = payload.sheets.length === 1 ? payload.sheets[0] : null;

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition":
      `attachment; filename="result-${slug(payload.exam.name)}` +
      `${single ? `-${slug(single.registration_no)}` : ""}.pdf"`,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "no-store",
    "X-Pdf-Pages": String(pages),
  });

  if (dropped > 0) headers.set("X-Pdf-Dropped-Glyphs", String(dropped));

  return new NextResponse(bytes as BodyInit, { headers });
}
