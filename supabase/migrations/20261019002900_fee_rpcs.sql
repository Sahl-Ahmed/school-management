-- ===========================================================================
-- 0029  Fee operations: charge generation, payment recording, reversal
-- ---------------------------------------------------------------------------
-- The schema from migration 0009 already prevents the two structural mistakes:
-- a partial unique index stops a student being billed twice for one period,
-- and receipts.payment_id is UNIQUE so one payment cannot yield two receipts.
-- Triggers keep fee_charges.amount_paid and status in step with allocations.
--
-- What is missing is atomicity across the several tables a payment touches,
-- and that is what these functions add. Recording a payment writes a payment
-- row, one allocation per charge settled, and a receipt — and PostgREST has no
-- transaction spanning several requests, so doing it as three calls would let
-- a crash leave money recorded against no charge, or a charge marked paid with
-- no receipt to hand the guardian.
--
-- DOUBLE SUBMISSION is handled by the caller generating the payment's uuid
-- before submitting. A second click sends the same id and hits the primary
-- key, so the money is recorded once. That is the same pattern the admission
-- forms use, and it is more reliable than a "already submitting" flag in the
-- browser, which a refresh defeats.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- generate_monthly_charges
-- ---------------------------------------------------------------------------
-- Bills every actively enrolled student for one month, at the rate configured
-- for their class. Idempotent: re-running it creates nothing, because the
-- partial unique index on fee_charges refuses a second charge for the same
-- student, fee type and period, and ON CONFLICT DO NOTHING turns that refusal
-- into a skip rather than an error.
--
-- A rate may be configured per class or school-wide (class_id NULL); the
-- per-class rate wins where both exist.
-- --------------------------------------------------------------------------
create or replace function public.generate_monthly_charges(
  p_academic_year_id uuid,
  p_fee_type_id uuid,
  p_period_year integer,
  p_period_month smallint,
  p_class_id uuid default null,
  p_due_day smallint default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_eligible integer;
  v_created  integer;
  v_monthly  boolean;
begin
  if not app.is_authority() then
    raise exception 'only the school office may generate fee charges'
      using errcode = 'insufficient_privilege';
  end if;

  select is_monthly into v_monthly
  from public.fee_types where id = p_fee_type_id;

  if v_monthly is null then
    raise exception 'unknown fee type' using errcode = 'foreign_key_violation';
  end if;

  if not v_monthly then
    raise exception 'that fee type is not a monthly fee, so it cannot be billed by month'
      using errcode = 'check_violation';
  end if;

  if p_period_month < 1 or p_period_month > 12 then
    raise exception 'month must be between 1 and 12' using errcode = 'check_violation';
  end if;

  with eligible as (
    select
      se.student_id,
      coalesce(per_class.amount, school_wide.amount) as amount
    from public.student_enrollments se
    left join public.fee_rates per_class
      on per_class.fee_type_id = p_fee_type_id
     and per_class.academic_year_id = p_academic_year_id
     and per_class.class_id = se.class_id
    left join public.fee_rates school_wide
      on school_wide.fee_type_id = p_fee_type_id
     and school_wide.academic_year_id = p_academic_year_id
     and school_wide.class_id is null
    where se.academic_year_id = p_academic_year_id
      and se.status = 'active'
      and (p_class_id is null or se.class_id = p_class_id)
      -- A student whose class has no rate and no school-wide fallback is
      -- skipped rather than billed zero, which would read as "nothing owed".
      and coalesce(per_class.amount, school_wide.amount) is not null
  ),
  inserted as (
    insert into public.fee_charges (
      student_id, fee_type_id, academic_year_id,
      period_year, period_month, amount, due_on, created_by
    )
    select
      e.student_id, p_fee_type_id, p_academic_year_id,
      p_period_year, p_period_month, e.amount,
      make_date(p_period_year, p_period_month, least(p_due_day, 28)),
      v_actor
    from eligible e
    -- The index that makes this idempotent is partial (status <> 'cancelled'),
    -- so the conflict target is named by its columns.
    on conflict do nothing
    returning 1
  )
  select
    (select count(*) from eligible),
    (select count(*) from inserted)
  into v_eligible, v_created;

  return jsonb_build_object(
    'eligible', v_eligible,
    'created', v_created,
    'already_billed', v_eligible - v_created
  );
end;
$$;

comment on function public.generate_monthly_charges(uuid, uuid, integer, smallint, uuid, smallint) is
  'Bills active students for one month. Idempotent: re-running creates nothing.';

revoke all on function public.generate_monthly_charges(uuid, uuid, integer, smallint, uuid, smallint)
  from public, anon;
grant execute on function public.generate_monthly_charges(uuid, uuid, integer, smallint, uuid, smallint)
  to authenticated;

-- --------------------------------------------------------------------------
-- charge_exam_fee
-- ---------------------------------------------------------------------------
-- Exam fees attach to an exam rather than to a calendar month, so they need
-- their own entry point. Same idempotency.
-- --------------------------------------------------------------------------
create or replace function public.charge_exam_fee(
  p_exam_id uuid,
  p_fee_type_id uuid,
  p_class_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_year   uuid;
  v_created integer;
  v_eligible integer;
begin
  if not app.is_authority() then
    raise exception 'only the school office may generate fee charges'
      using errcode = 'insufficient_privilege';
  end if;

  select academic_year_id into v_year from public.exams where id = p_exam_id;
  if v_year is null then
    raise exception 'unknown exam' using errcode = 'foreign_key_violation';
  end if;

  if not exists (
    select 1 from public.fee_types
    where id = p_fee_type_id and is_exam_fee
  ) then
    raise exception 'that fee type is not an exam fee' using errcode = 'check_violation';
  end if;

  with eligible as (
    select
      se.student_id,
      coalesce(per_class.amount, school_wide.amount) as amount
    from public.student_enrollments se
    left join public.fee_rates per_class
      on per_class.fee_type_id = p_fee_type_id
     and per_class.academic_year_id = v_year
     and per_class.class_id = se.class_id
    left join public.fee_rates school_wide
      on school_wide.fee_type_id = p_fee_type_id
     and school_wide.academic_year_id = v_year
     and school_wide.class_id is null
    where se.academic_year_id = v_year
      and se.status = 'active'
      and (p_class_id is null or se.class_id = p_class_id)
      and coalesce(per_class.amount, school_wide.amount) is not null
  ),
  inserted as (
    insert into public.fee_charges (
      student_id, fee_type_id, academic_year_id, exam_id, amount, created_by
    )
    select e.student_id, p_fee_type_id, v_year, p_exam_id, e.amount, v_actor
    from eligible e
    on conflict do nothing
    returning 1
  )
  select (select count(*) from eligible), (select count(*) from inserted)
  into v_eligible, v_created;

  return jsonb_build_object(
    'eligible', v_eligible,
    'created', v_created,
    'already_billed', v_eligible - v_created
  );
end;
$$;

revoke all on function public.charge_exam_fee(uuid, uuid, uuid) from public, anon;
grant execute on function public.charge_exam_fee(uuid, uuid, uuid) to authenticated;

-- ===========================================================================
-- record_payment
-- ---------------------------------------------------------------------------
-- Writes the payment, its allocations and the receipt in one transaction.
--
-- p_payload:
--   { "id": uuid,               -- generated by the caller for idempotency
--     "student_id": uuid,
--     "amount": numeric,
--     "method": payment_method,
--     "paid_at": timestamptz,   -- optional, defaults to now()
--     "reference_no": text,     -- optional (bKash trx id, cheque number)
--     "note": text,             -- optional
--     "allocations": [ { "charge_id": uuid, "amount": numeric }, ... ] }
--
-- The allocation amounts must sum to no more than the payment, which a trigger
-- from migration 0009 enforces per row. Allocating LESS than the payment is
-- allowed and left as an unallocated balance, because a guardian may pay a
-- round number against an odd total.
-- ===========================================================================
create or replace function public.record_payment(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := auth.uid();
  v_payment_id  uuid := (p_payload ->> 'id')::uuid;
  v_student_id  uuid := (p_payload ->> 'student_id')::uuid;
  v_amount      numeric(10,2) := (p_payload ->> 'amount')::numeric(10,2);
  v_alloc       jsonb;
  v_charge_id   uuid;
  v_charge      public.fee_charges%rowtype;
  v_alloc_amt   numeric(10,2);
  v_total_alloc numeric(10,2) := 0;
  v_receipt_no  text;
  v_snapshot    jsonb;
begin
  if not app.is_authority() then
    raise exception 'only the school office may record a payment'
      using errcode = 'insufficient_privilege';
  end if;

  if v_payment_id is null then
    raise exception 'a payment id is required' using errcode = 'null_value_not_allowed';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'the payment amount must be greater than zero'
      using errcode = 'check_violation';
  end if;

  -- Idempotency: a second submission of the same form carries the same id and
  -- stops here rather than taking the money twice.
  if exists (select 1 from public.payments where id = v_payment_id) then
    select r.receipt_no into v_receipt_no
    from public.receipts r where r.payment_id = v_payment_id;

    return jsonb_build_object(
      'payment_id', v_payment_id,
      'receipt_no', v_receipt_no,
      'duplicate', true
    );
  end if;

  insert into public.payments (
    id, student_id, amount, method, paid_at, reference_no, note, received_by
  )
  values (
    v_payment_id,
    v_student_id,
    v_amount,
    coalesce(nullif(p_payload ->> 'method', ''), 'cash')::public.payment_method,
    coalesce(nullif(p_payload ->> 'paid_at', '')::timestamptz, now()),
    nullif(btrim(coalesce(p_payload ->> 'reference_no', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
    v_actor
  );

  for v_alloc in
    select * from jsonb_array_elements(coalesce(p_payload -> 'allocations', '[]'::jsonb))
  loop
    v_charge_id := (v_alloc ->> 'charge_id')::uuid;
    v_alloc_amt := (v_alloc ->> 'amount')::numeric(10,2);

    select * into v_charge
    from public.fee_charges where id = v_charge_id
    for update;

    if not found then
      raise exception 'unknown fee charge' using errcode = 'foreign_key_violation';
    end if;

    -- A payment may only settle charges belonging to the student it names.
    if v_charge.student_id <> v_student_id then
      raise exception 'that charge belongs to a different student'
        using errcode = 'check_violation';
    end if;

    if v_charge.status in ('cancelled', 'waived') then
      raise exception 'that charge is % and cannot be paid', v_charge.status
        using errcode = 'check_violation';
    end if;

    if v_alloc_amt is null or v_alloc_amt <= 0 then
      raise exception 'each allocation must be greater than zero'
        using errcode = 'check_violation';
    end if;

    -- Overpaying a single charge is refused: the remainder belongs against
    -- another charge or as an unallocated balance, not inflating this one.
    if v_alloc_amt > (v_charge.amount - v_charge.amount_paid - v_charge.discount_amount) then
      raise exception
        'allocation of % exceeds the % outstanding on that charge',
        v_alloc_amt,
        (v_charge.amount - v_charge.amount_paid - v_charge.discount_amount)
        using errcode = 'check_violation';
    end if;

    insert into public.payment_allocations (payment_id, fee_charge_id, amount)
    values (v_payment_id, v_charge_id, v_alloc_amt);

    v_total_alloc := v_total_alloc + v_alloc_amt;
  end loop;

  if v_total_alloc > v_amount then
    raise exception 'allocations (%) exceed the payment (%)', v_total_alloc, v_amount
      using errcode = 'check_violation';
  end if;

  -- The receipt. receipts.payment_id is UNIQUE, so one payment can never
  -- produce two receipts however many times this is called.
  v_receipt_no := app.next_receipt_no();

  -- Frozen so a reprint matches the paper the guardian is holding, even if a
  -- fee amount or the student's class changes later.
  select jsonb_build_object(
    'student', jsonb_build_object(
      'full_name', s.full_name,
      'registration_no', s.registration_no,
      'class_name', c.name,
      'section_name', sec.name,
      'roll_no', se.roll_no
    ),
    'payment', jsonb_build_object(
      'amount', v_amount,
      'method', coalesce(nullif(p_payload ->> 'method', ''), 'cash'),
      'reference_no', nullif(btrim(coalesce(p_payload ->> 'reference_no', '')), ''),
      'allocated', v_total_alloc,
      'unallocated', v_amount - v_total_alloc
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'fee_type', ft.name,
        'period_year', fc.period_year,
        'period_month', fc.period_month,
        'exam', ex.name,
        'amount', pa.amount
      ) order by fc.period_year, fc.period_month), '[]'::jsonb)
      from public.payment_allocations pa
      join public.fee_charges fc on fc.id = pa.fee_charge_id
      join public.fee_types ft on ft.id = fc.fee_type_id
      left join public.exams ex on ex.id = fc.exam_id
      where pa.payment_id = v_payment_id
    )
  )
  into v_snapshot
  from public.students s
  left join public.student_enrollments se
    on se.student_id = s.id and se.status = 'active'
  left join public.classes c on c.id = se.class_id
  left join public.sections sec on sec.id = se.section_id
  where s.id = v_student_id;

  insert into public.receipts (payment_id, receipt_no, issued_by, snapshot)
  values (v_payment_id, v_receipt_no, v_actor, coalesce(v_snapshot, '{}'::jsonb));

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'receipt_no', v_receipt_no,
    'allocated', v_total_alloc,
    'unallocated', v_amount - v_total_alloc,
    'duplicate', false
  );
end;
$$;

comment on function public.record_payment(jsonb) is
  'Atomic payment, allocations and receipt. The caller-supplied id makes a double submission a no-op.';

revoke all on function public.record_payment(jsonb) from public, anon;
grant execute on function public.record_payment(jsonb) to authenticated;

-- ===========================================================================
-- reverse_payment
-- ---------------------------------------------------------------------------
-- Money is never deleted. Reversing sets reversed_at, which the trigger from
-- migration 0009 uses to re-open every charge the payment had cleared. The
-- receipt stays, because the guardian still holds the paper.
--
-- authority_admin only: an ordinary office user records payments but does not
-- undo them.
-- ===========================================================================
create or replace function public.reverse_payment(
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_reopened integer;
begin
  if not app.is_admin() then
    raise exception 'only a school administrator may reverse a payment'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reversing a payment requires a reason'
      using errcode = 'check_violation';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;

  if not found then
    raise exception 'unknown payment' using errcode = 'no_data_found';
  end if;

  if v_payment.reversed_at is not null then
    raise exception 'that payment was already reversed'
      using errcode = 'unique_violation';
  end if;

  update public.payments
     set reversed_at = now(),
         reversed_by = auth.uid(),
         reversal_reason = btrim(p_reason)
   where id = p_payment_id;

  select count(*) into v_reopened
  from public.payment_allocations where payment_id = p_payment_id;

  return jsonb_build_object(
    'payment_id', p_payment_id,
    'charges_reopened', v_reopened,
    'amount', v_payment.amount
  );
end;
$$;

comment on function public.reverse_payment(uuid, text) is
  'Reverses a payment and re-opens the charges it cleared. Admin only; requires a reason; audited.';

revoke all on function public.reverse_payment(uuid, text) from public, anon;
grant execute on function public.reverse_payment(uuid, text) to authenticated;

-- ===========================================================================
-- waive_charge
-- ---------------------------------------------------------------------------
-- A deliberate authority decision that a charge will not be collected. Kept
-- distinct from 'cancelled', which means the charge should not have existed.
-- ===========================================================================
create or replace function public.set_charge_status(
  p_charge_id uuid,
  p_status public.fee_charge_status,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charge public.fee_charges%rowtype;
begin
  if not app.is_admin() then
    raise exception 'only a school administrator may waive or cancel a charge'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status not in ('waived', 'cancelled', 'pending') then
    raise exception 'status must be waived, cancelled or pending'
      using errcode = 'check_violation';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'changing a charge''s status requires a reason'
      using errcode = 'check_violation';
  end if;

  select * into v_charge from public.fee_charges where id = p_charge_id for update;
  if not found then
    raise exception 'unknown fee charge' using errcode = 'no_data_found';
  end if;

  if v_charge.amount_paid > 0 and p_status in ('waived', 'cancelled') then
    raise exception
      'that charge already has % paid against it; reverse the payment first',
      v_charge.amount_paid
      using errcode = 'check_violation';
  end if;

  update public.fee_charges
     set status = p_status,
         note = btrim(p_reason)
   where id = p_charge_id;

  return jsonb_build_object('charge_id', p_charge_id, 'status', p_status);
end;
$$;

revoke all on function public.set_charge_status(uuid, public.fee_charge_status, text) from public, anon;
grant execute on function public.set_charge_status(uuid, public.fee_charge_status, text) to authenticated;

-- ===========================================================================
-- Monthly clearance, for the fee screens
-- ---------------------------------------------------------------------------
-- One row per student per month with what is owed and what is settled, which
-- is what both the office's collection view and a student's own fee page need.
-- ===========================================================================
create or replace function public.student_fee_summary(
  p_student_id uuid,
  p_academic_year_id uuid
)
returns table (
  charge_id     uuid,
  fee_type      text,
  fee_code      text,
  period_year   integer,
  period_month  smallint,
  exam_name     text,
  amount        numeric,
  amount_paid   numeric,
  discount      numeric,
  outstanding   numeric,
  status        public.fee_charge_status,
  due_on        date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    fc.id,
    ft.name,
    ft.code,
    fc.period_year,
    fc.period_month,
    ex.name,
    fc.amount,
    fc.amount_paid,
    fc.discount_amount,
    greatest(fc.amount - fc.amount_paid - fc.discount_amount, 0),
    fc.status,
    fc.due_on
  from public.fee_charges fc
  join public.fee_types ft on ft.id = fc.fee_type_id
  left join public.exams ex on ex.id = fc.exam_id
  where fc.student_id = p_student_id
    and fc.academic_year_id = p_academic_year_id
    -- Teachers have no business with a student's money, so they are absent
    -- from this check deliberately.
    and coalesce(
      app.is_authority() or app.owns_student_record(p_student_id),
      false
    )
  order by fc.period_year nulls last, fc.period_month nulls last, ft.name;
$$;

comment on function public.student_fee_summary(uuid, uuid) is
  'Per-charge fee position for one student. Authority or the student themselves; never a teacher.';

revoke all on function public.student_fee_summary(uuid, uuid) from public, anon;
grant execute on function public.student_fee_summary(uuid, uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Collection overview for the office: who owes what, worst first.
-- --------------------------------------------------------------------------
create or replace function public.fee_collection_overview(
  p_academic_year_id uuid,
  p_class_id uuid default null
)
returns table (
  student_id      uuid,
  full_name       text,
  registration_no text,
  class_name      text,
  section_name    text,
  roll_no         integer,
  billed          numeric,
  collected       numeric,
  outstanding     numeric,
  unpaid_months   bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.full_name,
    s.registration_no,
    c.name,
    sec.name,
    se.roll_no,
    coalesce(sum(fc.amount) filter (where fc.status <> 'cancelled'), 0),
    coalesce(sum(fc.amount_paid), 0),
    coalesce(sum(
      greatest(fc.amount - fc.amount_paid - fc.discount_amount, 0)
    ) filter (where fc.status in ('pending', 'partial')), 0),
    count(*) filter (where fc.status in ('pending', 'partial') and fc.period_month is not null)
  from public.student_enrollments se
  join public.students s on s.id = se.student_id
  join public.classes c on c.id = se.class_id
  join public.sections sec on sec.id = se.section_id
  left join public.fee_charges fc
    on fc.student_id = s.id
   and fc.academic_year_id = p_academic_year_id
  where se.academic_year_id = p_academic_year_id
    and se.status = 'active'
    and (p_class_id is null or se.class_id = p_class_id)
    and app.is_authority()
  group by s.id, s.full_name, s.registration_no, c.name, sec.name, se.roll_no, c.level_order
  order by 9 desc, c.level_order, se.roll_no;
$$;

comment on function public.fee_collection_overview(uuid, uuid) is
  'Per-student billed/collected/outstanding totals. Authority only.';

revoke all on function public.fee_collection_overview(uuid, uuid) from public, anon;
grant execute on function public.fee_collection_overview(uuid, uuid) to authenticated;
