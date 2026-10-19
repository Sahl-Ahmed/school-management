-- Exclusion constraints below need btree_gist operators from the extensions schema.
set search_path = public, extensions, pg_catalog;

-- ===========================================================================
-- 0003  School configuration: branding, academic years, terms, classes,
--       sections, subjects, grading scales, holidays
-- ---------------------------------------------------------------------------
-- Sections: the brief treats sections as optional. The model requires one so
-- that enrollment, routine and attendance have a single uniform parent. Every
-- class is seeded with one section; the UI hides the section selector when a
-- class has exactly one. This keeps roll-number uniqueness enforceable.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- school_settings — exactly one row, enforced by the primary key
-- --------------------------------------------------------------------------
create table public.school_settings (
  id                        boolean primary key default true check (id),
  name                      text not null default 'School',
  short_name                text,
  logo_path                 text,                     -- Supabase Storage object path
  email                     text,
  office_phone              text,
  address                   text,
  website                   text,
  signature_image_path      text,                     -- head teacher PNG for templates
  signature_holder_name     text,
  signature_holder_title    text,
  timezone                  text not null default 'Asia/Dhaka',
  currency                  text not null default 'BDT',
  default_locale            text not null default 'en' check (default_locale in ('en','bn')),

  -- Daily attendance SMS policy (see brief section 7). Exact values remain an
  -- owner decision (brief 12.7); these are documented defaults, not policy.
  daily_sms_enabled         boolean not null default false,
  daily_sms_grace_minutes   integer not null default 45
                              check (daily_sms_grace_minutes between 0 and 600),
  daily_sms_earliest_time   time not null default '16:00',

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger school_settings_touch_updated_at
  before update on public.school_settings
  for each row execute function app.touch_updated_at();

comment on table public.school_settings is
  'Single-row school branding and policy configuration. id is always true.';
comment on column public.school_settings.daily_sms_grace_minutes is
  'Minutes to wait after the last scheduled period before the daily summary may send.';

-- --------------------------------------------------------------------------
-- academic_years
-- --------------------------------------------------------------------------
create table public.academic_years (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) > 0),
  starts_on   date not null,
  ends_on     date not null,
  is_current  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint academic_years_date_order check (ends_on > starts_on)
);

-- At most one current year at a time.
create unique index academic_years_single_current_idx
  on public.academic_years ((true)) where is_current;

create trigger academic_years_touch_updated_at
  before update on public.academic_years
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- terms — the unit that feedback campaigns and term exams hang off
-- --------------------------------------------------------------------------
create table public.terms (
  id                       uuid primary key default gen_random_uuid(),
  academic_year_id         uuid not null references public.academic_years (id) on delete cascade,
  name                     text not null,
  sequence                 smallint not null check (sequence > 0),
  starts_on                date not null,
  ends_on                  date not null,
  -- The window whose attendance percentage is printed on this term's results.
  attendance_window_start  date,
  attendance_window_end    date,
  status                   public.term_status not null default 'upcoming',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint terms_date_order check (ends_on > starts_on),
  constraint terms_attendance_window_order check (
    attendance_window_start is null
    or attendance_window_end is null
    or attendance_window_end >= attendance_window_start
  ),
  unique (academic_year_id, sequence),
  unique (academic_year_id, name)
);

create trigger terms_touch_updated_at
  before update on public.terms
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- classes — Play, Nursery, Class 1..10, plus any the authority adds
-- --------------------------------------------------------------------------
create table public.classes (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique check (length(btrim(name)) > 0),
  -- Sort order so Play < Nursery < Class 1 < ... < Class 10 regardless of name.
  level_order  integer not null unique,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger classes_touch_updated_at
  before update on public.classes
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- sections
-- --------------------------------------------------------------------------
create table public.sections (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes (id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  capacity   integer check (capacity is null or capacity > 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, name)
);

create index sections_class_idx on public.sections (class_id);

create trigger sections_touch_updated_at
  before update on public.sections
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- subjects
-- --------------------------------------------------------------------------
create table public.subjects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  name_bn    text,
  code       text not null unique check (length(btrim(code)) > 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger subjects_touch_updated_at
  before update on public.subjects
  for each row execute function app.touch_updated_at();

-- Which subjects a class actually studies in a given year. Drives exam
-- configuration and the routine's subject picker.
create table public.class_subjects (
  id               uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  class_id         uuid not null references public.classes (id) on delete cascade,
  subject_id       uuid not null references public.subjects (id) on delete restrict,
  created_at       timestamptz not null default now(),
  unique (academic_year_id, class_id, subject_id)
);

create index class_subjects_lookup_idx
  on public.class_subjects (academic_year_id, class_id);

-- --------------------------------------------------------------------------
-- grading scales — the exact bands remain an owner decision (brief 12.1).
-- These tables hold whatever the authority configures; no scale is hard-coded
-- anywhere in application logic.
-- --------------------------------------------------------------------------
create table public.grading_scales (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  academic_year_id uuid references public.academic_years (id) on delete cascade,
  is_default       boolean not null default false,
  -- A subject scored below this percentage fails regardless of its band.
  subject_pass_pct numeric(5,2) not null default 33.00
                     check (subject_pass_pct >= 0 and subject_pass_pct <= 100),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (name, academic_year_id)
);

create unique index grading_scales_single_default_idx
  on public.grading_scales ((true)) where is_default;

create trigger grading_scales_touch_updated_at
  before update on public.grading_scales
  for each row execute function app.touch_updated_at();

create table public.grade_bands (
  id          uuid primary key default gen_random_uuid(),
  scale_id    uuid not null references public.grading_scales (id) on delete cascade,
  grade       text not null,
  min_pct     numeric(5,2) not null check (min_pct >= 0 and min_pct <= 100),
  max_pct     numeric(5,2) not null check (max_pct >= 0 and max_pct <= 100),
  grade_point numeric(4,2) not null check (grade_point >= 0),
  is_pass     boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint grade_bands_pct_order check (max_pct >= min_pct),
  unique (scale_id, grade)
);

-- Bands within one scale may not overlap, so a percentage maps to one grade.
alter table public.grade_bands
  add constraint grade_bands_no_overlap
  exclude using gist (
    scale_id with =,
    numrange(min_pct, max_pct, '[]') with &&
  );

create index grade_bands_scale_idx on public.grade_bands (scale_id, min_pct desc);

-- --------------------------------------------------------------------------
-- Weekends and holidays — these decide whether a school day exists at all,
-- which in turn decides whether a daily attendance SMS is due.
-- --------------------------------------------------------------------------
-- Weekdays use the Postgres dow convention: 0 = Sunday .. 6 = Saturday.
create table public.school_weekends (
  weekday smallint primary key check (weekday between 0 and 6)
);

comment on table public.school_weekends is
  'Weekdays on which the school runs no classes. 0 = Sunday .. 6 = Saturday.';

create table public.school_holidays (
  id               uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  holiday_date     date not null,
  name             text not null,
  -- NULL class_id means the holiday applies to the whole school.
  class_id         uuid references public.classes (id) on delete cascade,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null
);

create unique index school_holidays_school_wide_idx
  on public.school_holidays (academic_year_id, holiday_date)
  where class_id is null;

create unique index school_holidays_per_class_idx
  on public.school_holidays (academic_year_id, holiday_date, class_id)
  where class_id is not null;

create index school_holidays_date_idx on public.school_holidays (holiday_date);
