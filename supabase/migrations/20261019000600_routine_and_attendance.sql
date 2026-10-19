-- Exclusion constraints below need btree_gist operators from the extensions schema.
set search_path = public, extensions, pg_catalog;

-- ===========================================================================
-- 0006  Class routine, lesson occurrences, and student attendance
-- ---------------------------------------------------------------------------
-- The central correctness rule of this module:
--
--   A lesson whose teacher has NOT submitted attendance has no
--   student_attendance rows at all. It is never read as absence.
--
-- That is why attendance is recorded against a teaching_session (a concrete
-- occurrence of a scheduled period on a date) carrying its own submitted_at,
-- rather than against the routine row directly. The daily attendance SMS and
-- every attendance percentage both depend on this distinction.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- routine_periods — the recurring weekly timetable
-- --------------------------------------------------------------------------
create table public.routine_periods (
  id               uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  class_id         uuid not null references public.classes (id) on delete restrict,
  section_id       uuid not null references public.sections (id) on delete cascade,
  subject_id       uuid not null references public.subjects (id) on delete restrict,
  teacher_id       uuid not null references public.teachers (id) on delete restrict,

  -- Postgres dow convention: 0 = Sunday .. 6 = Saturday.
  weekday          smallint not null check (weekday between 0 and 6),
  period_no        smallint not null check (period_no > 0),
  starts_at        time not null,
  ends_at          time not null,

  -- Effective dating mirrors teacher_assignments so a mid-term teacher change
  -- closes the old row and opens a new one instead of rewriting history.
  effective_from   date not null,
  effective_to     date,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null,

  constraint routine_periods_time_order check (ends_at > starts_at),
  constraint routine_periods_date_order check (
    effective_to is null or effective_to >= effective_from
  )
);

-- A section cannot be in two places at once: no two overlapping periods for
-- the same section on the same weekday over overlapping effective dates.
alter table public.routine_periods
  add constraint routine_periods_no_section_clash
  exclude using gist (
    section_id with =,
    weekday with =,
    timerange(starts_at, ends_at, '[)') with &&,
    daterange(effective_from, effective_to, '[]') with &&
  );

-- Nor can a teacher be in two places at once.
alter table public.routine_periods
  add constraint routine_periods_no_teacher_clash
  exclude using gist (
    teacher_id with =,
    weekday with =,
    timerange(starts_at, ends_at, '[)') with &&,
    daterange(effective_from, effective_to, '[]') with &&
  );

create index routine_periods_section_day_idx
  on public.routine_periods (section_id, weekday, starts_at);

create index routine_periods_teacher_day_idx
  on public.routine_periods (teacher_id, weekday, starts_at);

comment on table public.routine_periods is
  'Recurring weekly timetable. Exclusion constraints prevent class and teacher clashes.';

-- --------------------------------------------------------------------------
-- cancelled_periods — a scheduled period called off on one specific date
-- --------------------------------------------------------------------------
-- A cancelled period is excluded from "was attendance submitted for every
-- scheduled period?" and therefore never blocks the daily SMS.
-- --------------------------------------------------------------------------
create table public.cancelled_periods (
  id                uuid primary key default gen_random_uuid(),
  routine_period_id uuid not null references public.routine_periods (id) on delete cascade,
  occurs_on         date not null,
  reason            text not null,
  cancelled_by      uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (routine_period_id, occurs_on)
);

create index cancelled_periods_date_idx on public.cancelled_periods (occurs_on);

-- --------------------------------------------------------------------------
-- teaching_sessions — one concrete occurrence of a period on a date
-- --------------------------------------------------------------------------
create table public.teaching_sessions (
  id                uuid primary key default gen_random_uuid(),
  routine_period_id uuid not null references public.routine_periods (id) on delete cascade,
  session_date      date not null,

  -- Copied from the routine at creation so that later routine edits do not
  -- silently restate who taught a past lesson.
  class_id          uuid not null references public.classes (id) on delete restrict,
  section_id        uuid not null references public.sections (id) on delete restrict,
  subject_id        uuid not null references public.subjects (id) on delete restrict,
  teacher_id        uuid not null references public.teachers (id) on delete restrict,
  period_no         smallint not null,
  starts_at         time not null,
  ends_at           time not null,

  -- NULL until the teacher presses submit. This is the flag that separates
  -- "no attendance taken" from "everyone absent".
  submitted_at      timestamptz,
  submitted_by      uuid references public.profiles (id) on delete set null,

  is_cancelled      boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (routine_period_id, session_date)
);

create index teaching_sessions_date_idx
  on public.teaching_sessions (session_date, section_id);

create index teaching_sessions_teacher_idx
  on public.teaching_sessions (teacher_id, session_date desc);

-- Finding lessons still awaiting submission drives both the teacher's own
-- to-do list and the authority's overdue-submission alert.
create index teaching_sessions_unsubmitted_idx
  on public.teaching_sessions (session_date, section_id)
  where submitted_at is null and not is_cancelled;

create trigger teaching_sessions_touch_updated_at
  before update on public.teaching_sessions
  for each row execute function app.touch_updated_at();

comment on column public.teaching_sessions.submitted_at is
  'NULL means the teacher has not submitted. Never interpret as absence.';

-- --------------------------------------------------------------------------
-- student_attendance
-- --------------------------------------------------------------------------
create table public.student_attendance (
  id                   uuid primary key default gen_random_uuid(),
  teaching_session_id  uuid not null references public.teaching_sessions (id) on delete cascade,
  student_id           uuid not null references public.students (id) on delete cascade,
  status               public.attendance_status not null,
  remark               text,
  marked_by            uuid references public.profiles (id) on delete set null,
  marked_at            timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (teaching_session_id, student_id)
);

create index student_attendance_student_idx
  on public.student_attendance (student_id);

create trigger student_attendance_touch_updated_at
  before update on public.student_attendance
  for each row execute function app.touch_updated_at();

comment on table public.student_attendance is
  'Explicit per-lesson attendance. Absence of a row means no submission, not absence.';
