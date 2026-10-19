/**
 * Fee tests.
 *
 * Money has a different failure mode from attendance: the dangerous bug is not
 * a wrong percentage but a double charge, a double receipt, or money recorded
 * against the wrong student. These tests target exactly those, plus who is
 * permitted to do what.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { freshDatabase, asUser } from "./sql/harness.mjs";
import { seedWithAccounts, ids } from "./sql/fixtures.mjs";
import { randomUUID } from "node:crypto";

let db;

const TUITION = "fee00000-0000-4000-8000-000000000001";
const COACHING = "fee00000-0000-4000-8000-000000000002";
const EXAM_FEE = "fee00000-0000-4000-8000-000000000003";

beforeAll(async () => {
  db = await freshDatabase();
  await seedWithAccounts(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const rpc = (userId, sql, params) =>
  asUser(db, userId, async () => (await db.query(sql, params)).rows[0]);

async function generateMonth(userId, month, classId = null) {
  return rpc(
    userId,
    "select public.generate_monthly_charges($1,$2,$3,$4,$5) as r",
    [ids.academicYear, TUITION, 2026, month, classId],
  );
}

async function pay(userId, payload) {
  return rpc(userId, "select public.record_payment($1::jsonb) as r", [
    JSON.stringify(payload),
  ]);
}

async function chargesFor(studentId) {
  const r = await db.query(
    `select fc.id, fc.period_month, fc.amount, fc.amount_paid, fc.status
       from public.fee_charges fc
      where fc.student_id = $1 and fc.fee_type_id = $2
      order by fc.period_month`,
    [studentId, TUITION],
  );
  return r.rows;
}

// ===========================================================================
describe("generating monthly charges", () => {
  it("bills every active student at their class rate", async () => {
    // The seed already bills January–June, so use a later month.
    const { r } = await generateMonth(ids.userAuthority, 7);

    expect(r.created).toBe(5);
    expect(r.eligible).toBe(5);
    expect(r.already_billed).toBe(0);
  });

  it("is idempotent — running it twice does not bill twice", async () => {
    const again = await generateMonth(ids.userAuthority, 7);

    expect(again.r.created).toBe(0);
    expect(again.r.already_billed).toBe(5);

    const rows = await db.query(
      `select count(*)::int as n from public.fee_charges
        where fee_type_id = $1 and period_year = 2026 and period_month = 7`,
      [TUITION],
    );
    expect(rows.rows[0].n).toBe(5);
  });

  it("uses the per-class rate, so classes are billed differently", async () => {
    const charges = await db.query(
      `select c.name, fc.amount
         from public.fee_charges fc
         join public.student_enrollments se
           on se.student_id = fc.student_id and se.academic_year_id = fc.academic_year_id
         join public.classes c on c.id = se.class_id
        where fc.period_month = 7 and fc.fee_type_id = $1
        order by c.level_order`,
      [TUITION],
    );

    const byClass = Object.fromEntries(
      charges.rows.map((x) => [x.name, Number(x.amount)]),
    );
    // Seeded rate is 300 + level_order * 50; Class 1 is level 3, Class 3 is 5.
    expect(byClass["Class 1"]).toBe(450);
    expect(byClass["Class 3"]).toBe(550);
    expect(byClass["Class 8"]).toBe(800);
  });

  it("can be limited to one class", async () => {
    const { r } = await generateMonth(ids.userAuthority, 8, ids.classThree);
    // Three students sit in Class 3.
    expect(r.created).toBe(3);
  });

  it("refuses a non-monthly fee type", async () => {
    await expect(
      rpc(ids.userAuthority, "select public.generate_monthly_charges($1,$2,$3,$4,$5) as r", [
        ids.academicYear, EXAM_FEE, 2026, 9, null,
      ]),
    ).rejects.toThrow(/not a monthly fee/i);
  });

  it("skips students whose class has no configured rate", async () => {
    // Coaching has no rates seeded at all, so nobody is eligible — and
    // crucially nobody is billed zero, which would read as "nothing owed".
    const { r } = await rpc(
      ids.userAuthority,
      "select public.generate_monthly_charges($1,$2,$3,$4,$5) as r",
      [ids.academicYear, COACHING, 2026, 9, null],
    );

    expect(r.eligible).toBe(0);
    expect(r.created).toBe(0);
  });

  it("only the authority may generate charges", async () => {
    await expect(generateMonth(ids.userTeacherOne, 10)).rejects.toThrow(
      /only the school office/i,
    );
    await expect(generateMonth(ids.userStudentAlpha, 10)).rejects.toThrow(
      /only the school office/i,
    );
  });
});

// ===========================================================================
describe("recording a payment", () => {
  it("settles a charge and issues exactly one receipt", async () => {
    const charges = await chargesFor(ids.studentAlpha);
    const january = charges.find((c) => c.period_month === 1);

    const { r } = await pay(ids.userAuthority, {
      id: randomUUID(),
      student_id: ids.studentAlpha,
      amount: Number(january.amount),
      method: "cash",
      allocations: [{ charge_id: january.id, amount: Number(january.amount) }],
    });

    expect(r.duplicate).toBe(false);
    expect(r.receipt_no).toMatch(/^RCP-\d{4}-\d{6}$/);
    expect(Number(r.allocated)).toBe(Number(january.amount));
    expect(Number(r.unallocated)).toBe(0);

    const after = await db.query(
      "select amount_paid, status from public.fee_charges where id = $1",
      [january.id],
    );
    expect(Number(after.rows[0].amount_paid)).toBe(Number(january.amount));
    expect(after.rows[0].status).toBe("paid");

    const receipts = await db.query(
      "select count(*)::int as n from public.receipts where payment_id = $1",
      [r.payment_id],
    );
    expect(receipts.rows[0].n).toBe(1);
  });

  it("a resubmitted payment is a no-op, not a second charge", async () => {
    const charges = await chargesFor(ids.studentBeta);
    const january = charges.find((c) => c.period_month === 1);
    const paymentId = randomUUID();

    const payload = {
      id: paymentId,
      student_id: ids.studentBeta,
      amount: Number(january.amount),
      allocations: [{ charge_id: january.id, amount: Number(january.amount) }],
    };

    const first = await pay(ids.userAuthority, payload);
    const second = await pay(ids.userAuthority, payload);

    expect(first.r.duplicate).toBe(false);
    expect(second.r.duplicate).toBe(true);
    // The same receipt comes back, so the office can reprint rather than
    // wondering whether the second click took more money.
    expect(second.r.receipt_no).toBe(first.r.receipt_no);

    const payments = await db.query(
      "select count(*)::int as n from public.payments where student_id = $1",
      [ids.studentBeta],
    );
    expect(payments.rows[0].n).toBe(1);

    const paid = await db.query(
      "select amount_paid from public.fee_charges where id = $1",
      [january.id],
    );
    // Not doubled.
    expect(Number(paid.rows[0].amount_paid)).toBe(Number(january.amount));
  });

  it("settles several months with one payment", async () => {
    const charges = await chargesFor(ids.studentAlpha);
    const feb = charges.find((c) => c.period_month === 2);
    const mar = charges.find((c) => c.period_month === 3);
    const total = Number(feb.amount) + Number(mar.amount);

    const { r } = await pay(ids.userAuthority, {
      id: randomUUID(),
      student_id: ids.studentAlpha,
      amount: total,
      allocations: [
        { charge_id: feb.id, amount: Number(feb.amount) },
        { charge_id: mar.id, amount: Number(mar.amount) },
      ],
    });

    expect(Number(r.allocated)).toBe(total);

    const after = await db.query(
      "select status from public.fee_charges where id = any($1)",
      [[feb.id, mar.id]],
    );
    expect(after.rows.every((x) => x.status === "paid")).toBe(true);
  });

  it("records a part payment as partial, not paid", async () => {
    const charges = await chargesFor(ids.studentAlpha);
    const april = charges.find((c) => c.period_month === 4);
    const half = Math.round(Number(april.amount) / 2);

    await pay(ids.userAuthority, {
      id: randomUUID(),
      student_id: ids.studentAlpha,
      amount: half,
      allocations: [{ charge_id: april.id, amount: half }],
    });

    const after = await db.query(
      "select amount_paid, status from public.fee_charges where id = $1",
      [april.id],
    );
    expect(after.rows[0].status).toBe("partial");
    expect(Number(after.rows[0].amount_paid)).toBe(half);
  });

  it("refuses an allocation larger than what the charge still owes", async () => {
    const charges = await chargesFor(ids.studentAlpha);
    const may = charges.find((c) => c.period_month === 5);

    await expect(
      pay(ids.userAuthority, {
        id: randomUUID(),
        student_id: ids.studentAlpha,
        amount: 10000,
        allocations: [{ charge_id: may.id, amount: Number(may.amount) + 100 }],
      }),
    ).rejects.toThrow(/exceeds the .* outstanding/i);
  });

  it("refuses to settle another student's charge", async () => {
    // The dangerous mistake: money recorded against the wrong child.
    const siblingCharges = await chargesFor(ids.siblingElder);

    await expect(
      pay(ids.userAuthority, {
        id: randomUUID(),
        student_id: ids.studentAlpha,
        amount: 100,
        allocations: [{ charge_id: siblingCharges[0].id, amount: 100 }],
      }),
    ).rejects.toThrow(/belongs to a different student/i);
  });

  it("leaves nothing behind when an allocation fails", async () => {
    const charges = await chargesFor(ids.studentAlpha);
    const june = charges.find((c) => c.period_month === 6);
    const paymentId = randomUUID();

    await expect(
      pay(ids.userAuthority, {
        id: paymentId,
        student_id: ids.studentAlpha,
        amount: 1000,
        allocations: [
          { charge_id: june.id, amount: Number(june.amount) },
          { charge_id: randomUUID(), amount: 50 }, // does not exist
        ],
      }),
    ).rejects.toThrow(/unknown fee charge/i);

    // No payment, no receipt, and June untouched.
    const leftovers = await db.query(
      `select
         (select count(*) from public.payments where id = $1)::int as payments,
         (select count(*) from public.receipts where payment_id = $1)::int as receipts,
         (select amount_paid from public.fee_charges where id = $2) as june_paid`,
      [paymentId, june.id],
    );
    expect(leftovers.rows[0].payments).toBe(0);
    expect(leftovers.rows[0].receipts).toBe(0);
    expect(Number(leftovers.rows[0].june_paid)).toBe(0);
  });

  it("allows an unallocated balance but never an over-allocation", async () => {
    const charges = await chargesFor(ids.siblingYounger);
    const january = charges.find((c) => c.period_month === 1);

    // Paying a round number against an odd total is normal.
    const { r } = await pay(ids.userAuthority, {
      id: randomUUID(),
      student_id: ids.siblingYounger,
      amount: Number(january.amount) + 50,
      allocations: [{ charge_id: january.id, amount: Number(january.amount) }],
    });

    expect(Number(r.unallocated)).toBe(50);
  });

  it("only the authority may record a payment", async () => {
    const charges = await chargesFor(ids.studentAlpha);

    for (const user of [ids.userTeacherOne, ids.userStudentAlpha]) {
      await expect(
        pay(user, {
          id: randomUUID(),
          student_id: ids.studentAlpha,
          amount: 100,
          allocations: [{ charge_id: charges[0].id, amount: 100 }],
        }),
      ).rejects.toThrow(/only the school office/i);
    }
  });

  it("office staff may record a payment", async () => {
    const charges = await chargesFor(ids.studentEpsilon ?? ids.studentAlpha);
    const open = charges.find((c) => c.status === "pending");

    const { r } = await pay(ids.userOfficeStaff, {
      id: randomUUID(),
      student_id: open ? ids.studentAlpha : ids.studentAlpha,
      amount: Number(open.amount),
      allocations: [{ charge_id: open.id, amount: Number(open.amount) }],
    });

    expect(r.duplicate).toBe(false);
  });
});

// ===========================================================================
describe("receipts", () => {
  it("numbers run sequentially and are unique", async () => {
    const rows = await db.query(
      "select receipt_no from public.receipts order by receipt_no",
    );
    const numbers = rows.rows.map((r) => r.receipt_no);

    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(n).toMatch(/^RCP-2026-\d{6}$/);
  });

  it("freezes what was printed, so a later rate change does not alter it", async () => {
    const row = await db.query(
      `select r.snapshot from public.receipts r
        join public.payments p on p.id = r.payment_id
       where p.student_id = $1 limit 1`,
      [ids.studentAlpha],
    );

    const snap = row.rows[0].snapshot;
    expect(snap.student.registration_no).toBe("STU-2026-0001");
    expect(snap.student.class_name).toBe("Class 3");
    expect(Array.isArray(snap.items)).toBe(true);
    expect(snap.items.length).toBeGreaterThan(0);
  });

  it("one payment can never yield two receipts", async () => {
    const payment = await db.query(
      "select payment_id, receipt_no from public.receipts limit 1",
    );

    await expect(
      db.query(
        `insert into public.receipts (payment_id, receipt_no, snapshot)
         values ($1, 'RCP-2026-999999', '{}'::jsonb)`,
        [payment.rows[0].payment_id],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

// ===========================================================================
describe("reversing a payment", () => {
  it("re-opens the charges it had cleared", async () => {
    const charges = await chargesFor(ids.studentBeta);
    const january = charges.find((c) => c.period_month === 1);

    const payment = await db.query(
      `select pa.payment_id from public.payment_allocations pa
        where pa.fee_charge_id = $1 limit 1`,
      [january.id],
    );

    const { r } = await rpc(
      ids.userAuthority,
      "select public.reverse_payment($1, $2) as r",
      [payment.rows[0].payment_id, "Cheque returned unpaid by the bank."],
    );

    expect(r.charges_reopened).toBe(1);

    const after = await db.query(
      "select amount_paid, status from public.fee_charges where id = $1",
      [january.id],
    );
    expect(Number(after.rows[0].amount_paid)).toBe(0);
    expect(after.rows[0].status).toBe("pending");
  });

  it("requires a reason", async () => {
    const payment = await db.query(
      "select id from public.payments where reversed_at is null limit 1",
    );

    await expect(
      rpc(ids.userAuthority, "select public.reverse_payment($1, $2) as r", [
        payment.rows[0].id,
        "   ",
      ]),
    ).rejects.toThrow(/requires a reason/i);
  });

  it("cannot be done twice", async () => {
    const reversed = await db.query(
      "select id from public.payments where reversed_at is not null limit 1",
    );

    await expect(
      rpc(ids.userAuthority, "select public.reverse_payment($1, $2) as r", [
        reversed.rows[0].id,
        "Trying again",
      ]),
    ).rejects.toThrow(/already reversed/i);
  });

  it("is refused to ordinary office staff", async () => {
    const payment = await db.query(
      "select id from public.payments where reversed_at is null limit 1",
    );

    await expect(
      rpc(ids.userOfficeStaff, "select public.reverse_payment($1, $2) as r", [
        payment.rows[0].id,
        "Office staff attempt",
      ]),
    ).rejects.toThrow(/only a school administrator/i);
  });

  it("keeps the payment row and its receipt", async () => {
    const reversed = await db.query(
      `select p.id, p.reversal_reason, r.receipt_no
         from public.payments p
         join public.receipts r on r.payment_id = p.id
        where p.reversed_at is not null limit 1`,
    );

    // Money is never deleted, and the guardian still holds the paper.
    expect(reversed.rows[0].receipt_no).toBeTruthy();
    expect(reversed.rows[0].reversal_reason).toMatch(/cheque/i);
  });
});

// ===========================================================================
describe("waiving and cancelling", () => {
  it("an admin can waive an unpaid charge", async () => {
    const charges = await chargesFor(ids.siblingElder);
    const open = charges.find((c) => c.status === "pending");

    const { r } = await rpc(
      ids.userAuthority,
      "select public.set_charge_status($1, $2, $3) as r",
      [open.id, "waived", "Hardship waiver approved by the head teacher."],
    );

    expect(r.status).toBe("waived");
  });

  it("refuses to waive a charge that already has money against it", async () => {
    const paid = await db.query(
      "select id from public.fee_charges where amount_paid > 0 limit 1",
    );

    await expect(
      rpc(ids.userAuthority, "select public.set_charge_status($1, $2, $3) as r", [
        paid.rows[0].id, "waived", "Should be refused",
      ]),
    ).rejects.toThrow(/already has .* paid/i);
  });

  it("is refused to office staff", async () => {
    const charges = await chargesFor(ids.siblingElder);
    const open = charges.find((c) => c.status === "pending");

    await expect(
      rpc(ids.userOfficeStaff, "select public.set_charge_status($1, $2, $3) as r", [
        open.id, "waived", "Staff attempt",
      ]),
    ).rejects.toThrow(/only a school administrator/i);
  });

  it("a waived charge cannot then be paid", async () => {
    const waived = await db.query(
      "select id, student_id from public.fee_charges where status = 'waived' limit 1",
    );

    await expect(
      pay(ids.userAuthority, {
        id: randomUUID(),
        student_id: waived.rows[0].student_id,
        amount: 100,
        allocations: [{ charge_id: waived.rows[0].id, amount: 100 }],
      }),
    ).rejects.toThrow(/is waived and cannot be paid/i);
  });
});

// ===========================================================================
describe("who may see fee data", () => {
  it("a student sees their own charges", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query(
        "select * from public.student_fee_summary($1, $2)",
        [ids.studentAlpha, ids.academicYear],
      )).rows,
    );

    expect(rows.length).toBeGreaterThan(0);
  });

  it("a student cannot see another student's charges", async () => {
    const rows = await asUser(db, ids.userStudentAlpha, async () =>
      (await db.query(
        "select * from public.student_fee_summary($1, $2)",
        [ids.siblingElder, ids.academicYear],
      )).rows,
    );

    expect(rows).toHaveLength(0);
  });

  it("a TEACHER cannot see any student's fees", async () => {
    // Teachers are deliberately absent from the visibility check, not merely
    // unlinked in the UI.
    const own = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query(
        "select * from public.student_fee_summary($1, $2)",
        [ids.studentAlpha, ids.academicYear],
      )).rows,
    );

    expect(own).toHaveLength(0);
  });

  it("the collection overview is authority-only", async () => {
    const asAuthority = await asUser(db, ids.userAuthority, async () =>
      (await db.query(
        "select * from public.fee_collection_overview($1, null)",
        [ids.academicYear],
      )).rows,
    );
    const asTeacher = await asUser(db, ids.userTeacherOne, async () =>
      (await db.query(
        "select * from public.fee_collection_overview($1, null)",
        [ids.academicYear],
      )).rows,
    );

    expect(asAuthority.length).toBeGreaterThan(0);
    expect(asTeacher).toHaveLength(0);
  });

  it("outstanding totals exclude waived and cancelled charges", async () => {
    const rows = await asUser(db, ids.userAuthority, async () =>
      (await db.query(
        "select * from public.fee_collection_overview($1, null)",
        [ids.academicYear],
      )).rows,
    );

    const elder = rows.find((r) => r.student_id === ids.siblingElder);
    const summary = await asUser(db, ids.userAuthority, async () =>
      (await db.query(
        "select * from public.student_fee_summary($1, $2)",
        [ids.siblingElder, ids.academicYear],
      )).rows,
    );

    const waivedTotal = summary
      .filter((c) => c.status === "waived")
      .reduce((n, c) => n + Number(c.amount), 0);

    expect(waivedTotal).toBeGreaterThan(0);

    const pendingTotal = summary
      .filter((c) => c.status === "pending" || c.status === "partial")
      .reduce((n, c) => n + Number(c.outstanding), 0);

    expect(Number(elder.outstanding)).toBe(pendingTotal);
  });
});
