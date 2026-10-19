"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Fee actions.
 *
 * Every one of these delegates to an RPC that does its work in a single
 * transaction (migration 0029), because a payment touches three tables and a
 * partial write would leave money recorded against no charge, or a charge
 * marked paid with no receipt to give the guardian.
 *
 * DOUBLE SUBMISSION: the payment form generates a uuid when it renders and
 * sends it as the payment's id. A second click carries the same id, the RPC
 * sees the row already exists, and returns the original receipt instead of
 * taking the money twice. A disabled-button guard in the browser would not
 * survive a refresh or a flaky connection; this does.
 */

export type FeeState = {
  ok?: boolean;
  error?: string;
  notice?: string;
  receiptNo?: string;
  paymentId?: string;
  duplicate?: boolean;
  fieldErrors?: Record<string, string[]>;
};

// ---------------------------------------------------------------------------
const generateSchema = z.object({
  academic_year_id: z.uuid(),
  fee_type_id: z.uuid("Choose a fee type"),
  period_year: z.coerce.number().int().min(2000).max(2200),
  period_month: z.coerce.number().int().min(1).max(12),
  class_id: z.string().optional().default(""),
  due_day: z.coerce.number().int().min(1).max(28).default(10),
});

export async function generateMonthlyCharges(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const supabase = await createClient();

  const parsed = generateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  const { data, error } = await supabase.rpc("generate_monthly_charges", {
    p_academic_year_id: input.academic_year_id,
    p_fee_type_id: input.fee_type_id,
    p_period_year: input.period_year,
    p_period_month: input.period_month,
    p_class_id: input.class_id || null,
    p_due_day: input.due_day,
  });

  if (error) return { error: humanise(error.message) };

  const result = data as { eligible: number; created: number; already_billed: number };

  revalidatePath("/authority/fees");

  // Reported in full rather than as "done": re-running a month is a normal
  // thing to do after admitting a late student, and the office needs to see
  // that the already-billed students were skipped rather than re-charged.
  return {
    ok: true,
    notice:
      result.created === 0
        ? `No new charges. All ${result.already_billed} eligible students were already billed for this month.`
        : `${result.created} charge${result.created === 1 ? "" : "s"} created.` +
          (result.already_billed > 0
            ? ` ${result.already_billed} student${result.already_billed === 1 ? " was" : "s were"} already billed and left untouched.`
            : "") +
          (result.eligible === 0
            ? " No student's class has a rate configured for this fee."
            : ""),
  };
}

// ---------------------------------------------------------------------------
const paymentSchema = z.object({
  payment_id: z.uuid(),
  student_id: z.uuid(),
  amount: z.coerce
    .number({ message: "Enter the amount received" })
    .positive("The amount must be greater than zero")
    .max(1_000_000),
  method: z.enum(["cash", "bkash", "nagad", "rocket", "bank", "cheque", "other"]),
  reference_no: z.string().trim().max(64).optional(),
  note: z.string().trim().max(300).optional(),
  allocations: z.array(
    z.object({ charge_id: z.uuid(), amount: z.coerce.number().positive() }),
  ).min(1, "Choose at least one charge to settle"),
});

export async function recordPayment(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const supabase = await createClient();

  // Allocations arrive as one JSON field. The payment form builds them from its
  // own state, for the same reason the attendance roster does: React 19 resets
  // a form after an action, so per-row inputs cannot be relied on for a retry.
  const rawAllocations = formData.get("allocations");
  let allocations: unknown = [];

  if (typeof rawAllocations === "string" && rawAllocations.length > 0) {
    try {
      allocations = JSON.parse(rawAllocations);
    } catch {
      return { error: "The selected charges could not be read. Please re-enter them." };
    }
  }

  const parsed = paymentSchema.safeParse({
    payment_id: formData.get("payment_id"),
    student_id: formData.get("student_id"),
    amount: formData.get("amount"),
    method: formData.get("method") ?? undefined,
    // FormData.get returns null for an absent field and Zod's .optional()
    // rejects null, so these are normalised.
    reference_no: formData.get("reference_no") ?? undefined,
    note: formData.get("note") ?? undefined,
    allocations,
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: first?.message ?? "Please check the payment details.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  const allocated = input.allocations.reduce((n, a) => n + a.amount, 0);
  if (allocated > input.amount) {
    return {
      error: `The charges selected come to ৳${allocated}, which is more than the ৳${input.amount} received.`,
    };
  }

  const { data, error } = await supabase.rpc("record_payment", {
    p_payload: {
      id: input.payment_id,
      student_id: input.student_id,
      amount: input.amount,
      method: input.method,
      reference_no: input.reference_no || null,
      note: input.note || null,
      allocations: input.allocations.map((a) => ({
        charge_id: a.charge_id,
        amount: a.amount,
      })),
    },
  });

  if (error) return { error: humanise(error.message) };

  const result = data as {
    payment_id: string;
    receipt_no: string;
    duplicate: boolean;
    unallocated?: number;
  };

  revalidatePath("/authority/fees");
  revalidatePath(`/authority/fees/${input.student_id}`);

  return {
    ok: true,
    paymentId: result.payment_id,
    receiptNo: result.receipt_no,
    duplicate: result.duplicate,
    notice: result.duplicate
      ? `This payment was already recorded. Receipt ${result.receipt_no} — no further money was taken.`
      : `Payment recorded. Receipt ${result.receipt_no}.` +
        (result.unallocated && Number(result.unallocated) > 0
          ? ` ৳${result.unallocated} is unallocated and remains as credit.`
          : ""),
  };
}

// ---------------------------------------------------------------------------
export async function reversePayment(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const supabase = await createClient();

  const parsed = z
    .object({
      payment_id: z.uuid(),
      student_id: z.uuid(),
      reason: z.string().trim().min(5, "Give a reason of at least five characters"),
    })
    .safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "A reason is required." };
  }

  const { data, error } = await supabase.rpc("reverse_payment", {
    p_payment_id: parsed.data.payment_id,
    p_reason: parsed.data.reason,
  });

  if (error) return { error: humanise(error.message) };

  const result = data as { charges_reopened: number; amount: number };

  revalidatePath("/authority/fees");
  revalidatePath(`/authority/fees/${parsed.data.student_id}`);

  return {
    ok: true,
    notice:
      `Payment of ৳${result.amount} reversed. ` +
      `${result.charges_reopened} charge${result.charges_reopened === 1 ? "" : "s"} re-opened. ` +
      `The payment and its receipt are kept, and the reversal is in the audit log.`,
  };
}

// ---------------------------------------------------------------------------
export async function setChargeStatus(
  _prev: FeeState,
  formData: FormData,
): Promise<FeeState> {
  const supabase = await createClient();

  const parsed = z
    .object({
      charge_id: z.uuid(),
      student_id: z.uuid(),
      status: z.enum(["waived", "cancelled", "pending"]),
      reason: z.string().trim().min(5, "Give a reason of at least five characters"),
    })
    .safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "A reason is required." };
  }

  const { error } = await supabase.rpc("set_charge_status", {
    p_charge_id: parsed.data.charge_id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });

  if (error) return { error: humanise(error.message) };

  revalidatePath(`/authority/fees/${parsed.data.student_id}`);

  return {
    ok: true,
    notice:
      parsed.data.status === "pending"
        ? "The charge is payable again."
        : `The charge is now ${parsed.data.status}. The decision is in the audit log.`,
  };
}

// ---------------------------------------------------------------------------
function humanise(message: string): string {
  if (message.includes("only the school office")) {
    return "Only the school office can do that.";
  }
  if (message.includes("only a school administrator")) {
    return "Only a school administrator can do that. Ask an administrator to make this change.";
  }
  if (message.includes("belongs to a different student")) {
    return "One of those charges belongs to a different student. Reload the page and try again.";
  }
  if (message.includes("exceeds the") && message.includes("outstanding")) {
    return "One allocation is more than that charge still owes. Reduce it and try again.";
  }
  if (message.includes("and cannot be paid")) {
    return "One of those charges has been waived or cancelled, so it cannot be paid.";
  }
  if (message.includes("already has") && message.includes("paid")) {
    return "That charge already has money against it. Reverse the payment before waiving it.";
  }
  if (message.includes("already reversed")) {
    return "That payment was already reversed.";
  }
  if (message.includes("requires a reason")) {
    return "A reason is required, and it is recorded in the audit log.";
  }
  if (message.includes("not a monthly fee")) {
    return "That fee type is not billed monthly. Use the exam fee action instead.";
  }
  if (message.includes("row-level security")) {
    return "You do not have permission to do that.";
  }
  return `Could not complete that: ${message}`;
}
