-- ===========================================================================
-- 0009  Fee configuration, charges, payments and receipts
-- ---------------------------------------------------------------------------
-- The money model separates three things that are often conflated:
--
--   fee_charges        — what a student owes (one row per billable period)
--   payments           — money actually received, with who recorded it
--   payment_allocations— how a payment was applied across charges
--
-- A single payment can clear several months at once, and a charge can be
-- settled by several payments, so the allocation table carries the amounts
-- rather than either side holding a single foreign key.
--
-- Duplicate charges are prevented structurally by a unique index on the
-- billing period, so clicking "add monthly fee" twice cannot bill twice.
-- ===========================================================================

create table public.fee_types (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  code            text not null unique check (length(btrim(code)) > 0),
  -- Monthly fee types are billed per (year, month); others are one-off or
  -- tied to a specific exam.
  is_monthly      boolean not null default true,
  -- Exam fees attach to an exam rather than to a calendar month.
  is_exam_fee     boolean not null default false,
  description     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fee_types_period_kind check (not (is_monthly and is_exam_fee))
);

create trigger fee_types_touch_updated_at
  before update on public.fee_types
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- fee_rates — the amount for a fee type, per class, per year
-- --------------------------------------------------------------------------
create table public.fee_rates (
  id               uuid primary key default gen_random_uuid(),
  fee_type_id      uuid not null references public.fee_types (id) on delete cascade,
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  -- NULL class_id is a school-wide default for this fee type.
  class_id         uuid references public.classes (id) on delete cascade,
  amount           numeric(10,2) not null check (amount >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index fee_rates_per_class_idx
  on public.fee_rates (fee_type_id, academic_year_id, class_id)
  where class_id is not null;

create unique index fee_rates_school_wide_idx
  on public.fee_rates (fee_type_id, academic_year_id)
  where class_id is null;

create trigger fee_rates_touch_updated_at
  before update on public.fee_rates
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- fee_charges — what a student owes
-- --------------------------------------------------------------------------
create table public.fee_charges (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students (id) on delete cascade,
  fee_type_id      uuid not null references public.fee_types (id) on delete restrict,
  academic_year_id uuid not null references public.academic_years (id) on delete restrict,

  -- For monthly fees. NULL for exam and one-off charges.
  period_year      integer check (period_year is null or period_year between 2000 and 2200),
  period_month     smallint check (period_month is null or period_month between 1 and 12),
  -- For exam fees.
  exam_id          uuid references public.exams (id) on delete set null,

  amount           numeric(10,2) not null check (amount >= 0),
  -- Maintained by trigger from payment_allocations; never written by the client.
  amount_paid      numeric(10,2) not null default 0 check (amount_paid >= 0),
  discount_amount  numeric(10,2) not null default 0 check (discount_amount >= 0),

  due_on           date,
  status           public.fee_charge_status not null default 'pending',
  note             text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null,

  constraint fee_charges_monthly_period check (
    (period_year is null) = (period_month is null)
  )
);

-- Structural duplicate prevention. COALESCE lets one partial index cover
-- monthly, exam and one-off charges without NULL defeating uniqueness.
create unique index fee_charges_no_duplicate_idx
  on public.fee_charges (
    student_id,
    fee_type_id,
    academic_year_id,
    coalesce(period_year, 0),
    coalesce(period_month, 0),
    coalesce(exam_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status <> 'cancelled';

create index fee_charges_student_idx
  on public.fee_charges (student_id, academic_year_id, period_year, period_month);

create index fee_charges_outstanding_idx
  on public.fee_charges (student_id)
  where status in ('pending', 'partial');

create trigger fee_charges_touch_updated_at
  before update on public.fee_charges
  for each row execute function app.touch_updated_at();

comment on index public.fee_charges_no_duplicate_idx is
  'Prevents billing the same student twice for one period. Cancelled charges are exempt.';
comment on column public.fee_charges.amount_paid is
  'Derived from payment_allocations by trigger. Not client-writable in practice.';

-- --------------------------------------------------------------------------
-- payments and allocations
-- --------------------------------------------------------------------------
create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.students (id) on delete restrict,
  amount         numeric(10,2) not null check (amount > 0),
  method         public.payment_method not null default 'cash',
  paid_at        timestamptz not null default now(),
  reference_no   text,
  note           text,
  -- The office user who recorded it. Required for the audit trail.
  received_by    uuid references public.profiles (id) on delete set null,

  -- Reversal rather than deletion: a payment row is never removed.
  reversed_at    timestamptz,
  reversed_by    uuid references public.profiles (id) on delete set null,
  reversal_reason text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint payments_reversal_needs_reason check (
    reversed_at is null or length(btrim(coalesce(reversal_reason, ''))) > 0
  )
);

create index payments_student_idx on public.payments (student_id, paid_at desc);

create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function app.touch_updated_at();

create table public.payment_allocations (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references public.payments (id) on delete cascade,
  fee_charge_id  uuid not null references public.fee_charges (id) on delete restrict,
  amount         numeric(10,2) not null check (amount > 0),
  created_at     timestamptz not null default now(),
  unique (payment_id, fee_charge_id)
);

create index payment_allocations_charge_idx
  on public.payment_allocations (fee_charge_id);

-- --------------------------------------------------------------------------
-- Keep fee_charges.amount_paid and status in step with allocations.
-- --------------------------------------------------------------------------
create or replace function app.recalc_fee_charge(p_charge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount    numeric(10,2);
  v_discount  numeric(10,2);
  v_paid      numeric(10,2);
  v_status    public.fee_charge_status;
  v_current   public.fee_charge_status;
begin
  select amount, discount_amount, status
    into v_amount, v_discount, v_current
  from public.fee_charges
  where id = p_charge_id
  for update;

  if not found then
    return;
  end if;

  -- Reversed payments do not count towards clearance.
  select coalesce(sum(pa.amount), 0)
    into v_paid
  from public.payment_allocations pa
  join public.payments p on p.id = pa.payment_id
  where pa.fee_charge_id = p_charge_id
    and p.reversed_at is null;

  -- Waived and cancelled are deliberate authority states; never overwrite them.
  if v_current in ('waived', 'cancelled') then
    update public.fee_charges set amount_paid = v_paid where id = p_charge_id;
    return;
  end if;

  if v_paid + v_discount >= v_amount then
    v_status := 'paid';
  elsif v_paid > 0 then
    v_status := 'partial';
  else
    v_status := 'pending';
  end if;

  update public.fee_charges
     set amount_paid = v_paid,
         status      = v_status
   where id = p_charge_id;
end;
$$;

create or replace function app.payment_allocations_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app.recalc_fee_charge(old.fee_charge_id);
    return old;
  end if;

  perform app.recalc_fee_charge(new.fee_charge_id);
  if tg_op = 'UPDATE' and old.fee_charge_id <> new.fee_charge_id then
    perform app.recalc_fee_charge(old.fee_charge_id);
  end if;
  return new;
end;
$$;

create trigger payment_allocations_sync_charge
  after insert or update or delete on public.payment_allocations
  for each row execute function app.payment_allocations_sync();

-- Reversing a payment must re-open every charge it had cleared.
create or replace function app.payments_reversal_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_charge uuid;
begin
  if old.reversed_at is distinct from new.reversed_at then
    for v_charge in
      select fee_charge_id from public.payment_allocations where payment_id = new.id
    loop
      perform app.recalc_fee_charge(v_charge);
    end loop;
  end if;
  return new;
end;
$$;

create trigger payments_reversal_recalc
  after update of reversed_at on public.payments
  for each row execute function app.payments_reversal_sync();

-- A payment may not be allocated beyond its own value.
create or replace function app.enforce_allocation_within_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_amount numeric(10,2);
  v_allocated      numeric(10,2);
begin
  select amount into v_payment_amount
  from public.payments where id = new.payment_id
  for update;

  select coalesce(sum(amount), 0) into v_allocated
  from public.payment_allocations
  where payment_id = new.payment_id
    and (tg_op = 'INSERT' or id <> new.id);

  if v_allocated + new.amount > v_payment_amount then
    raise exception
      'allocations (%) would exceed payment amount (%)',
      v_allocated + new.amount, v_payment_amount
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger payment_allocations_within_payment
  before insert or update on public.payment_allocations
  for each row execute function app.enforce_allocation_within_payment();

-- --------------------------------------------------------------------------
-- receipts — one per payment, with a human-readable sequential number
-- --------------------------------------------------------------------------
create sequence if not exists public.receipt_no_seq start 1;

create table public.receipts (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null unique references public.payments (id) on delete cascade,
  receipt_no  text not null unique,
  issued_at   timestamptz not null default now(),
  issued_by   uuid references public.profiles (id) on delete set null,
  pdf_path    text,
  -- Frozen amounts and student details as printed, so a reprint matches the
  -- paper the guardian is holding.
  snapshot    jsonb not null default '{}'::jsonb
);

comment on table public.receipts is
  'One receipt per payment. The unique payment_id prevents issuing two receipts for one payment.';

create or replace function app.next_receipt_no()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'RCP-' || to_char(now() at time zone 'Asia/Dhaka', 'YYYY') || '-'
       || lpad(nextval('public.receipt_no_seq')::text, 6, '0');
$$;
