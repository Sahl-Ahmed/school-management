import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildExamRoutinePdf } from "@/lib/pdf/exam-routine";
import { loadExamRoutine, slug } from "@/lib/school/document-data";
import { schoolToday, longDate } from "@/lib/school/calendar";

/**
 * The exam schedule as a downloadable A4 PDF, school-wide or for one class.
 *
 * `exam_routine_data` returns nothing to a student until the routine is
 * published, so the unpublished case is a 404 for them and a full draft sheet
 * for staff — who need to proof-read it before pinning it up. A staff copy is
 * stamped "Draft" on every page for exactly that reason.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ examId: string }> },
) {
  const { examId } = await params;
  const classFilter = new URL(request.url).searchParams.get("class");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });

  const payload = await loadExamRoutine(examId);
  if (!payload) {
    return new NextResponse("No exam routine is available", { status: 404 });
  }

  // Filtering by class name rather than id keeps the URL readable on a notice
  // board printout and matches what the heading says.
  const rows = classFilter
    ? payload.rows.filter((r) => r.class_name === classFilter)
    : payload.rows;

  const { bytes, dropped, pages } = await buildExamRoutinePdf({
    school: payload.school,
    exam: payload.exam,
    rows,
    classFilter,
    generatedAt: longDate(schoolToday()),
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition":
      `attachment; filename="exam-routine-${slug(payload.exam.name)}` +
      `${classFilter ? `-${slug(classFilter)}` : ""}.pdf"`,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "no-store",
    "X-Pdf-Pages": String(pages),
  });

  if (dropped > 0) headers.set("X-Pdf-Dropped-Glyphs", String(dropped));

  return new NextResponse(bytes as BodyInit, { headers });
}
