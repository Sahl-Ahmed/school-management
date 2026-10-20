import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAdmitCardPdf } from "@/lib/pdf/admit-card";
import { loadAdmitCard, slug } from "@/lib/school/document-data";
import { schoolToday, longDate } from "@/lib/school/calendar";

/**
 * One student's admit card as a downloadable A4 PDF.
 *
 * Eligibility is checked HERE as well as at issue, and the card is refused if
 * unmet. That is deliberate duplication: a route that merely rendered whatever
 * the database handed back would print a usable card for a blocked student
 * whenever someone kept an old URL, and an admit card's whole purpose is to be
 * accepted at a door.
 *
 * The data comes from `admit_card_data`, which performs its own visibility
 * check, so a student requesting a classmate's card is refused by the database
 * rather than by a conditional here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ examId: string; studentId: string }> },
) {
  const { examId, studentId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });

  const payload = await loadAdmitCard(studentId, examId);
  if (!payload) {
    // Indistinguishable from "not yours", on purpose: a 403 here would confirm
    // the student and exam exist.
    return new NextResponse("No admit card is available", { status: 404 });
  }

  if (!payload.eligibility.eligible) {
    return new NextResponse(
      `This admit card is blocked: ${payload.eligibility.blocks.join(", ")}. ` +
        `Clear the outstanding requirements first.`,
      { status: 409 },
    );
  }

  const { bytes, dropped } = await buildAdmitCardPdf({
    school: payload.school,
    generatedAt: longDate(schoolToday()),
    cards: [{
      student: payload.student,
      exam: payload.exam,
      seat_token: payload.seat_token,
      subjects: payload.subjects,
      overridden: Boolean(payload.eligibility.overridden),
    }],
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition":
      `attachment; filename="admit-card-${slug(payload.student.registration_no)}.pdf"`,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "no-store",
  });

  if (dropped > 0) headers.set("X-Pdf-Dropped-Glyphs", String(dropped));

  return new NextResponse(bytes as BodyInit, { headers });
}
