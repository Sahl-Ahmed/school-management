import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildReceiptPdf, type ReceiptSnapshot } from "@/lib/pdf/receipt";
import { one } from "@/lib/supabase/relations";

/**
 * A fee receipt as a downloadable A4 PDF.
 *
 * Read under the CALLER's own permissions, so RLS decides who may have it: the
 * authority for any payment, and a student for their own. A student asking for
 * another student's receipt gets nothing back and therefore a 404 — reported
 * as "not found" rather than "forbidden", because saying forbidden would
 * confirm the payment exists.
 *
 * Everything printed comes from receipts.snapshot, frozen at the moment the
 * payment was recorded, so a reprint matches the paper the guardian holds.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  const { paymentId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });

  const { data: payment } = await supabase
    .from("payments")
    .select(
      `id, amount, method, paid_at, reversed_at, reference_no,
       receipts(receipt_no, issued_at, snapshot),
       received_by`,
    )
    .eq("id", paymentId)
    .maybeSingle();

  const receipt = one<{ receipt_no: string; issued_at: string; snapshot: ReceiptSnapshot }>(
    payment?.receipts,
  );

  if (!payment || !receipt) {
    return new NextResponse("No receipt is available for that payment", { status: 404 });
  }

  const [{ data: settings }, { data: issuer }] = await Promise.all([
    supabase
      .from("school_settings")
      .select("name, address, office_phone, email")
      .maybeSingle(),
    payment.received_by
      ? supabase.from("profiles").select("full_name").eq("id", payment.received_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const bytes = await buildReceiptPdf({
    receiptNo: receipt.receipt_no,
    issuedAt: receipt.issued_at,
    paidAt: payment.paid_at,
    reversedAt: payment.reversed_at,
    snapshot: receipt.snapshot ?? {},
    school: {
      name: settings?.name ?? "School",
      address: settings?.address ?? null,
      office_phone: settings?.office_phone ?? null,
      email: settings?.email ?? null,
    },
    receivedBy: issuer?.full_name ?? null,
  });

  return new NextResponse(bytes as BodyInit, {
    headers: new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${receipt.receipt_no}.pdf"`,
      "Content-Length": String(bytes.byteLength),
      // A reversal must show on a reprint, so this is never cached.
      "Cache-Control": "no-store",
    }),
  });
}
