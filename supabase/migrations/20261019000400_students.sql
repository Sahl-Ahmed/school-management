-- ===========================================================================
-- 0004  Students, their contact numbers, and year-by-year enrollment history
-- ---------------------------------------------------------------------------
-- Two structural decisions worth stating plainly:
--
-- 1. Sensitive identifiers (parent NIDs, birth certificate number) live in
--    student_private_ids, NOT on students. Postgres RLS is row-level only, so
--    the only reliable way to keep teachers and the public QR page away from
--    those columns is to put them in a different table with its own policies.
--
-- 2. A guardian phone number is NOT unique and is NOT an account identifier.
--    Two siblings legitimately share one number. The login identifier is
--    students.registration_no.
-- ===========================================================================

create table public.students (
  id                    uuid primary key default gen_random_uuid(),

  -- The public-facing login identifier. Unique, permanent, survives promotion.
  registration_no       text not null unique check (length(btrim(registration_no)) > 0),

  full_name             text not null check (length(btrim(full_name)) > 0),
  full_name_bn          text,
  gender                public.gender not null,
  date_of_birth         date not null,
  blood_group           public.blood_group,

  -- Printed on cards and result sheets, never on the public QR page.
  father_name           text not null check (length(btrim(father_name)) > 0),
  mother_name           text not null check (length(btrim(mother_name)) > 0),

  photo_path            text,          -- Supabase Storage path; compressed < 200 KB
  photo_bytes           integer check (photo_bytes is null or photo_bytes > 0),

  -- Links to the Supabase Auth identity. NULL until the student activates.
  auth_user_id          uuid unique references auth.users (id) on delete set null,

  status                public.enrollment_status not null default 'active',
  admitted_on           date not null default current_date,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.profiles (id) on delete set null
);

-- Case-insensitive uniqueness: 'STU-001' and 'stu-001' must not coexist.
create unique index students_registration_no_lower_idx
  on public.students (lower(registration_no));

create index students_name_trgm_idx on public.students (lower(full_name));
create index students_status_idx on public.students (status);

create trigger students_touch_updated_at
  before update on public.students
  for each row execute function app.touch_updated_at();

comment on table public.students is
  'Permanent student identity. Class, section and roll live in student_enrollments.';
comment on column public.students.registration_no is
  'Login identifier. Unique and permanent across promotion to a new class.';
comment on column public.students.photo_bytes is
  'Size of the stored, client-compressed photo. Enforced below 200 KB on upload.';

-- --------------------------------------------------------------------------
-- student_private_ids — authority-only. Never joined into teacher, student or
-- public queries.
-- --------------------------------------------------------------------------
create table public.student_private_ids (
  student_id            uuid primary key references public.students (id) on delete cascade,
  father_nid            text,
  mother_nid            text,
  birth_certificate_no  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- The brief requires at least one parent NID, with both optional.
  constraint student_private_ids_at_least_one_nid check (
    coalesce(nullif(btrim(father_nid), ''), nullif(btrim(mother_nid), '')) is not null
  )
);

create trigger student_private_ids_touch_updated_at
  before update on public.student_private_ids
  for each row execute function app.touch_updated_at();

comment on table public.student_private_ids is
  'Sensitive identifiers, isolated so that only the authority role can read them.';

-- --------------------------------------------------------------------------
-- student_contacts — guardian / parent / emergency numbers
-- --------------------------------------------------------------------------
-- Exactly one contact per student is the SMS and OTP destination. Enforced by
-- a partial unique index rather than a column on students, so that changing
-- the destination is an ordinary audited row change.
-- --------------------------------------------------------------------------
create table public.student_contacts (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students (id) on delete cascade,
  label         text not null default 'guardian'
                  check (label in ('guardian','father','mother','emergency','other')),
  holder_name   text,
  -- Stored normalised to +880XXXXXXXXXX by the application layer.
  phone         text not null check (phone ~ '^\+8801[3-9][0-9]{8}$'),
  -- The single number that receives attendance / result SMS and account OTPs.
  is_sms_target boolean not null default false,
  -- Set once an OTP sent to this number has been successfully verified.
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (student_id, phone)
);

create unique index student_contacts_single_sms_target_idx
  on public.student_contacts (student_id) where is_sms_target;

-- Siblings share a guardian number, so this index is intentionally NOT unique.
create index student_contacts_phone_idx on public.student_contacts (phone);

create trigger student_contacts_touch_updated_at
  before update on public.student_contacts
  for each row execute function app.touch_updated_at();

comment on index public.student_contacts_phone_idx is
  'Non-unique by design: two siblings may share one guardian phone number.';

-- --------------------------------------------------------------------------
-- student_enrollments — class / section / roll per academic year
-- --------------------------------------------------------------------------
-- Promotion inserts a new row; it never overwrites the previous one. This is
-- what preserves "which class was this student in during term 2 of 2025".
-- --------------------------------------------------------------------------
create table public.student_enrollments (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references public.students (id) on delete cascade,
  academic_year_id   uuid not null references public.academic_years (id) on delete restrict,
  class_id           uuid not null references public.classes (id) on delete restrict,
  section_id         uuid not null references public.sections (id) on delete restrict,
  roll_no            integer not null check (roll_no > 0),
  status             public.enrollment_status not null default 'active',
  enrolled_on        date not null default current_date,
  left_on            date,
  promoted_from_id   uuid references public.student_enrollments (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,

  -- One enrollment per student per year.
  unique (student_id, academic_year_id),
  -- A roll number is unique within a section for a given year.
  unique (academic_year_id, section_id, roll_no)
);

create index student_enrollments_section_idx
  on public.student_enrollments (academic_year_id, section_id)
  where status = 'active';

create index student_enrollments_student_idx
  on public.student_enrollments (student_id);

create trigger student_enrollments_touch_updated_at
  before update on public.student_enrollments
  for each row execute function app.touch_updated_at();

comment on table public.student_enrollments is
  'Per-year class/section/roll history. Promotion inserts a row, never updates one.';
