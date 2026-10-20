import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAdmitCardPdf } from "@/lib/pdf/admit-card";
import { loadAdmitCardsForExam, slug } from "@/lib/school/document-data";
import { schoolToday, longDate } from "@/lib/school/calendar";

/**
 * A whole class's admit cards, three to an A4 sheet.
 *
 * Office-only, because it reads every student's eligibility: the underlying
 * `exam_admit_overview` guards on app.is_authority() and returns nothing to
 * anyone else, which is why an empty result is reported as 404 rather than 403.
 *
 * Students who are not eligible are LEFT OUT of the stack, and the count is
 * returned in a header so the screen can say how many were skipped. Printing
 * them with a warning band would put a card an invigilator will accept into the
 * hands of a student the rules say cannot sit.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ examId: string }> },
) {
  const { examId } = await params;
  const classId = new URL(request.url).searchParams.get("class");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });

  const loaded = await loadAdmitCardsForExam(examId, classId);
  if (!loaded) {
    return new NextResponse("No admit cards are available", { status: 404 });
  }

  if (loaded.cards.length === 0) {
    const reason = loaded.skipped.length
      ? `All ${loaded.skipped.length} students are currently blocked. ` +
        `Clear feedback and fees first.`
      : "No students are enrolled for this exam.";
    return new NextResponse(reason, { status: 409 });
  }

  const { bytes, dropped, pages } = await buildAdmitCardPdf({
    school: loaded.school,
    cards: loaded.cards,
    generatedAt: longDate(schoolToday()),
  });

  const name = loaded.cards[0]?.exam.name ?? "exam";

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="admit-cards-${slug(name)}.pdf"`,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "no-store",
    "X-Admit-Cards": String(loaded.cards.length),
    "X-Admit-Skipped": String(loaded.skipped.length),
    "X-Pdf-Pages": String(pages),
  });

  if (dropped > 0) headers.set("X-Pdf-Dropped-Glyphs", String(dropped));

  return new NextResponse(bytes as BodyInit, { headers });
}
