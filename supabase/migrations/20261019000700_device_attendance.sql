-- Exclusion constraints below need btree_gist operators from the extensions schema.
set search_path = public, extensions, pg_catalog;

-- ===========================================================================
-- 0007  Fingerprint terminal (ZKTeco K40) and derived teacher attendance
-- ---------------------------------------------------------------------------
-- Raw punches and derived daily summaries are kept strictly apart:
--
--   raw_punch_events        — immutable, exactly as the terminal reported them
--   teacher_daily_attendance — recomputed from raw events plus shift, holiday
--                              and approved-leave rules
--
-- The dedupe_key on raw_punch_events is what stops an offline terminal's
-- backlog, replayed after the sync PC comes back up, from inflating anyone's
-- attendance. Re-importing the same log is a no-op.
--
-- NOTE: no fingerprint template is ever stored here. Templates stay on the
-- terminal; this database holds only the device-user-id to teacher mapping.
-- ===========================================================================

create table public.devices (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  model              text not null default 'ZKTeco K40',
  serial_no          text unique,
  location           text,
  -- LAN address of the terminal. Reachable only by the on-site sync service;
  -- this port must never be exposed to the public internet.
  ip_address         inet,
  port               integer default 4370 check (port between 1 and 65535),
  timezone           text not null default 'Asia/Dhaka',

  -- Reported by the local sync service so the authority portal can show
  -- whether the bridge is actually alive.
  last_sync_at       timestamptz,
  last_sync_status   text,
  last_sync_error    text,
  -- Highest punch timestamp already ingested; the bridge resumes from here.
  last_event_at      timestamptz,

  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger devices_touch_updated_at
  before update on public.devices
  for each row execute function app.touch_updated_at();

comment on column public.devices.ip_address is
  'LAN address used by the on-site bridge only. Never expose this port publicly.';

-- --------------------------------------------------------------------------
-- device_users — the authority-entered mapping from terminal user id to teacher
-- --------------------------------------------------------------------------
create table public.device_users (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid not null references public.devices (id) on delete cascade,
  -- The numeric/string user id shown on the K40 itself.
  device_user_id   text not null check (length(btrim(device_user_id)) > 0),
  teacher_id       uuid not null references public.teachers (id) on delete cascade,

  -- The brief asks for a minimum of three distinct fingers per teacher.
  -- Recorded by the authority after enrolling and testing each finger on the
  -- terminal. Enrolling one finger three times is not three fingers.
  enrolled_fingers smallint not null default 0 check (enrolled_fingers between 0 and 10),
  enrolled_at      timestamptz,
  enrolled_by      uuid references public.profiles (id) on delete set null,
  last_verified_at timestamptz,
  notes            text,

  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (device_id, device_user_id)
);

-- A teacher holds at most one active enrollment per device.
create unique index device_users_active_teacher_idx
  on public.device_users (device_id, teacher_id) where is_active;

create trigger device_users_touch_updated_at
  before update on public.device_users
  for each row execute function app.touch_updated_at();

comment on column public.device_users.enrolled_fingers is
  'Count of DISTINCT fingers enrolled on the terminal. Target is at least 3.';

-- --------------------------------------------------------------------------
-- raw_punch_events — immutable record of what the terminal reported
-- --------------------------------------------------------------------------
create table public.raw_punch_events (
  id               bigint generated always as identity primary key,
  device_id        uuid not null references public.devices (id) on delete cascade,
  device_user_id   text not null,

  -- The terminal's own timestamp, preserved exactly. Clock drift is corrected
  -- when deriving summaries, never by editing this column.
  punched_at       timestamptz not null,
  -- The terminal's verify/state code, kept raw for diagnosis.
  punch_state      smallint,
  verify_mode      smallint,

  -- Resolved from device_users at ingest; NULL when the terminal reports a
  -- user id nobody has mapped yet. Those rows surface as an authority warning
  -- rather than being silently discarded.
  teacher_id       uuid references public.teachers (id) on delete set null,

  raw_payload      jsonb,

  -- device | user | timestamp | state. The uniqueness of this key is the whole
  -- defence against duplicate and replayed offline logs.
  dedupe_key       text not null unique,

  received_at      timestamptz not null default now(),
  -- Set once this event has been folded into teacher_daily_attendance.
  processed_at     timestamptz
);

create index raw_punch_events_teacher_day_idx
  on public.raw_punch_events (teacher_id, punched_at);

create index raw_punch_events_unprocessed_idx
  on public.raw_punch_events (received_at) where processed_at is null;

create index raw_punch_events_unmapped_idx
  on public.raw_punch_events (device_id, device_user_id) where teacher_id is null;

comment on table public.raw_punch_events is
  'Immutable terminal punches. Never edited; corrections go to teacher_daily_attendance.';
comment on column public.raw_punch_events.dedupe_key is
  'device|user|timestamp|state. Unique, so replayed offline logs cannot double-count.';

-- --------------------------------------------------------------------------
-- work_shifts — the rule set used to derive late minutes and missed days
-- --------------------------------------------------------------------------
create table public.work_shifts (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique,
  starts_at           time not null,
  ends_at             time not null,
  -- Minutes after starts_at that are not counted as late.
  grace_minutes       integer not null default 10 check (grace_minutes >= 0),
  -- A punch earlier than this is treated as the same day's arrival.
  earliest_in         time not null default '05:00',
  -- A punch later than this is treated as the same day's departure.
  latest_out          time not null default '23:00',
  is_default          boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint work_shifts_time_order check (ends_at > starts_at)
);

create unique index work_shifts_single_default_idx
  on public.work_shifts ((true)) where is_default;

create trigger work_shifts_touch_updated_at
  before update on public.work_shifts
  for each row execute function app.touch_updated_at();

-- Per-teacher shift assignment; falls back to the default shift when absent.
create table public.teacher_shifts (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references public.teachers (id) on delete cascade,
  shift_id       uuid not null references public.work_shifts (id) on delete restrict,
  effective_from date not null,
  effective_to   date,
  created_at     timestamptz not null default now(),
  constraint teacher_shifts_date_order check (
    effective_to is null or effective_to >= effective_from
  )
);

alter table public.teacher_shifts
  add constraint teacher_shifts_no_overlap
  exclude using gist (
    teacher_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  );

-- --------------------------------------------------------------------------
-- teacher_daily_attendance — derived, recomputable, correctable
-- --------------------------------------------------------------------------
create table public.teacher_daily_attendance (
  id                  uuid primary key default gen_random_uuid(),
  teacher_id          uuid not null references public.teachers (id) on delete cascade,
  work_date           date not null,

  first_in            timestamptz,
  last_out            timestamptz,
  punch_count         integer not null default 0,
  late_minutes        integer not null default 0 check (late_minutes >= 0),
  early_out_minutes   integer not null default 0 check (early_out_minutes >= 0),
  worked_minutes      integer check (worked_minutes is null or worked_minutes >= 0),

  status              public.teacher_day_status not null default 'no_data',

  -- An authority correction. The derived values above are kept so the original
  -- machine reading stays visible next to the corrected one.
  is_manual_override  boolean not null default false,
  override_status     public.teacher_day_status,
  override_reason     text,
  overridden_by       uuid references public.profiles (id) on delete set null,
  overridden_at       timestamptz,

  -- Set when status came from an approved leave_request rather than punches.
  leave_request_id    uuid references public.leave_requests (id) on delete set null,

  computed_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (teacher_id, work_date),
  constraint teacher_daily_attendance_override_needs_reason check (
    not is_manual_override
    or (override_status is not null and length(btrim(coalesce(override_reason, ''))) > 0)
  )
);

create index teacher_daily_attendance_date_idx
  on public.teacher_daily_attendance (work_date desc);

create trigger teacher_daily_attendance_touch_updated_at
  before update on public.teacher_daily_attendance
  for each row execute function app.touch_updated_at();

comment on table public.teacher_daily_attendance is
  'Derived daily summary. Recomputable from raw_punch_events; corrections are audited.';
comment on column public.teacher_daily_attendance.override_status is
  'Authority-corrected status. The machine-derived status stays in status for comparison.';
