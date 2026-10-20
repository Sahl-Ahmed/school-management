import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AdmitCard, AdmitSubject } from "@/lib/pdf/admit-card";
import type { ExamRoutineRow } from "@/lib/pdf/exam-routine";
import type { ResultSheet } from "@/lib/pdf/result-sheet";
import type { SchoolBranding } from "@/lib/pdf/base";

/**
 * Loaders shared by the print routes and the screens.
 *
 * Every one of these reads through an RPC that performs its own visibility
 * check, so a route does not get to decide who may see what. A student asking
 * for a classmate's admit card is refused by `admit_card_data`, not by a
 * conditional in a route handler that someone might later forget to copy into
 * the next route.
 */

export type AdmitCardPayload = {
  student: AdmitCard["student"];
  exam: AdmitCard["exam"] & { id: string };
  school: SchoolBranding & { logo_path: string | null };
  seat_token: string | null;
  subjects: AdmitSubject[];
  eligibility: {
    eligible: boolean;
    blocks: string[];
    overridden?: boolean;
    outstanding_monthly?: number | string;
    outstanding_exam_fee?: number | string;
    detail?: string;
  };
};

/** One student's admit card data, or null when the caller may not see it. */
export async function loadAdmitCard(
  studentId: string,
  examId: string,
): Promise<AdmitCardPayload | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admit_card_data", {
    p_student_id: studentId,
    p_exam_id: examId,
  });

  if (error || !data) return null;
  return data as AdmitCardPayload;
}

/**
 * Every eligible student's admit card for one exam, optionally one class.
 *
 * Ineligible students are EXCLUDED rather than printed with a warning band:
 * a card in a stack is a card an invigilator will accept, and the brief is
 * explicit that unmet rules block issue. The caller is told how many were left
 * out so the office can chase them.
 */
export async function loadAdmitCardsForExam(
  examId: string,
  classId: string | null,
): Promise<{
  school: SchoolBranding;
  cards: AdmitCard[];
  skipped: { full_name: string; roll_no: number; blocks: string[] }[];
} | null> {
  const supabase = await createClient();

  const { data: overview, error } = await supabase.rpc("exam_admit_overview", {
    p_exam_id: examId,
    p_class_id: classId,
  });

  if (error) return null;

  const rows = (overview ?? []) as {
    student_id: string;
    full_name: string;
    roll_no: number;
    eligible: boolean;
    blocks: string[];
  }[];

  const cards: AdmitCard[] = [];
  const skipped: { full_name: string; roll_no: number; blocks: string[] }[] = [];
  let school: SchoolBranding | null = null;

  for (const row of rows) {
    if (!row.eligible) {
      skipped.push({ full_name: row.full_name, roll_no: row.roll_no, blocks: row.blocks });
      continue;
    }

    const payload = await loadAdmitCard(row.student_id, examId);
    if (!payload) continue;

    school ??= payload.school;
    cards.push({
      student: payload.student,
      exam: payload.exam,
      seat_token: payload.seat_token,
      subjects: payload.subjects,
      overridden: Boolean(payload.eligibility.overridden),
    });
  }

  if (!school) {
    const { data } = await supabase
      .from("school_settings")
      .select("name, short_name, address, office_phone, email")
      .maybeSingle();
    school = (data as SchoolBranding) ?? {
      name: "School", address: null, office_phone: null, email: null,
    };
  }

  return { school, cards, skipped };
}

export type ExamRoutinePayload = {
  exam: {
    name: string;
    term_name: string;
    academic_year: string;
    starts_on: string | null;
    ends_on: string | null;
    routine_published_at: string | null;
  };
  school: SchoolBranding;
  rows: ExamRoutineRow[];
};

export async function loadExamRoutine(examId: string): Promise<ExamRoutinePayload | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("exam_routine_data", { p_exam_id: examId });

  // The function returns NULL rather than raising when the caller may not see
  // the routine — a student before publication — so a null here means either
  // "no such exam" or "not for you", which is what the route should report.
  if (error || !data) return null;
  return data as ExamRoutinePayload;
}

export type ResultSheetPayload = {
  exam: {
    name: string;
    term_name: string;
    academic_year: string;
    results_published_at: string | null;
  };
  school: SchoolBranding;
  sheets: ResultSheet[];
};

export async function loadResultSheets(
  examId: string,
  opts: { studentId?: string | null; sectionId?: string | null } = {},
): Promise<ResultSheetPayload | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("result_sheet_data", {
    p_exam_id: examId,
    p_student_id: opts.studentId ?? null,
    p_section_id: opts.sectionId ?? null,
  });

  if (error || !data) return null;
  return data as ResultSheetPayload;
}

/**
 * Downloads a student photo from Storage for embedding in a card.
 *
 * Returns null on any failure. A missing or unreadable photo must not prevent
 * a card being printed — the office can see the empty frame and fix the photo —
 * so this never throws.
 */
export async function loadPhotoBytes(path: string | null): Promise<Uint8Array | null> {
  if (!path) return null;

  const supabase = await createClient();

  // Private bucket; the download runs under the caller's own Storage policies,
  // so a student can fetch their own photo and the office can fetch any.
  const { data, error } = await supabase.storage.from("student-photos").download(path);
  if (error || !data) return null;

  try {
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}

/** A filename-safe slug. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "document";
}
