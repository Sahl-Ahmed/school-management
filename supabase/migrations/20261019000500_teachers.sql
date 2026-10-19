-- Exclusion constraints below need btree_gist operators from the extensions schema.
set search_path = public, extensions, pg_catalog;

-- ===========================================================================
-- 0005  Teachers and their effective-dated class/section/subject assignments
-- ---------------------------------------------------------------------------
-- teacher_assignments is the single source of truth for teacher authorisation:
-- which students a teacher may see, which attendance they may submit, which
-- marks they may enter, and which feedback forms students receive about them.
--
-- Assignments are effective-dated so that replacing a teacher mid-term does
-- not rewrite who taught the earlier part of the term.
-- ===========================================================================

create table public.teachers (
  id               uuid primary key default gen_random_uuid(),
  employee_code    text not null unique check (length(btrim(employee_code)) > 0),
  full_name        text not null check (length(btrim(full_name)) > 0),
  full_name_bn     text,
  gender           public.gender not null,
  blood_group      public.blood_group,
  father_name      text,
  mother_name      text,

  -- OTP destination for activation and password recovery.
  personal_phone   text not null check (personal_phone ~ '^\+8801[3-9][0-9]{8}$'),
  alternate_phone  text check (alternate_phone is null
                               or alternate_phone ~ '^\+8801[3-9][0-9]{8}$'),
  email            text,

  education        text,
  designation      text,
  joined_on        date,

  photo_path       text,

  auth_user_id     uuid unique references auth.users (id) on delete set null,
  is_active        boolean not null default true,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null
);

create index teachers_active_idx on public.teachers (is_active);
create index teachers_name_idx on public.teachers (lower(full_name));

create trigger teachers_touch_updated_at
  before update on public.teachers
  for each row execute function app.touch_updated_at();

comment on column public.teachers.personal_phone is
  'Verified by OTP at activation. Receives password-recovery codes.';

-- --------------------------------------------------------------------------
-- teacher_private_ids — authority-only, same reasoning as student_private_ids
-- --------------------------------------------------------------------------
create table public.teacher_private_ids (
  teacher_id  uuid primary key references public.teachers (id) on delete cascade,
  nid         text not null check (length(btrim(nid)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger teacher_private_ids_touch_updated_at
  before update on public.teacher_private_ids
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- teacher_assignments
-- --------------------------------------------------------------------------
create table public.teacher_assignments (
  id               uuid primary key default gen_random_uuid(),
  teacher_id       uuid not null references public.teachers (id) on delete cascade,
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  class_id         uuid not null references public.classes (id) on delete restrict,
  section_id       uuid not null references public.sections (id) on delete restrict,
  subject_id       uuid not null references public.subjects (id) on delete restrict,

  effective_from   date not null,
  -- NULL means "still in effect".
  effective_to     date,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null,

  constraint teacher_assignments_date_order check (
    effective_to is null or effective_to >= effective_from
  )
);

-- One teacher at a time per section+subject: two teachers may not hold the
-- same section/subject over overlapping dates.
alter table public.teacher_assignments
  add constraint teacher_assignments_no_overlap
  exclude using gist (
    section_id with =,
    subject_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  );

create index teacher_assignments_teacher_idx
  on public.teacher_assignments (teacher_id, academic_year_id);

create index teacher_assignments_section_idx
  on public.teacher_assignments (section_id, subject_id);

comment on table public.teacher_assignments is
  'Authoritative scope of a teacher''s access. Effective-dated; never rewritten in place.';

-- --------------------------------------------------------------------------
-- leave_requests
-- --------------------------------------------------------------------------
create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references public.teachers (id) on delete cascade,
  starts_on     date not null,
  ends_on       date not null,
  reason        text not null check (length(btrim(reason)) > 0),
  status        public.leave_status not null default 'pending',
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint leave_requests_date_order check (ends_on >= starts_on)
);

create index leave_requests_teacher_idx
  on public.leave_requests (teacher_id, starts_on desc);

create index leave_requests_pending_idx
  on public.leave_requests (status) where status = 'pending';

-- An approved leave may not overlap another approved leave for the same teacher.
alter table public.leave_requests
  add constraint leave_requests_no_approved_overlap
  exclude using gist (
    teacher_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status = 'approved');

create trigger leave_requests_touch_updated_at
  before update on public.leave_requests
  for each row execute function app.touch_updated_at();
