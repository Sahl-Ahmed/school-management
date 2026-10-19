-- ===========================================================================
-- 0013  Notification jobs, SMS delivery logs, and OTP challenges
-- ---------------------------------------------------------------------------
-- The daily attendance SMS requirement is "exactly one summary per student per
-- school day". That is enforced here by notification_jobs.dedupe_key being
-- UNIQUE, with the key built as:
--
--     daily_attendance|<student_id>|<YYYY-MM-DD>
--
-- A second attempt to create the job — a re-run of the scheduler, an overlapping
-- cron, a manual retry — fails on the unique index instead of sending a second
-- message. The same mechanism guards result and class-test SMS.
--
-- OTP codes are stored only as a hash. The plaintext code exists in memory
-- long enough to be handed to the SMS provider and nowhere else.
-- ===========================================================================

create table public.notification_jobs (
  id              uuid primary key default gen_random_uuid(),
  type            public.notification_type not null,

  -- Exactly one recipient subject, depending on type.
  student_id      uuid references public.students (id) on delete cascade,
  teacher_id      uuid references public.teachers (id) on delete cascade,

  -- Normalised destination, resolved when the job is created so that a later
  -- contact change cannot redirect an already-queued message.
  target_phone    text not null check (target_phone ~ '^\+8801[3-9][0-9]{8}$'),

  -- The school day this job belongs to. Part of the dedupe key.
  job_date        date,

  -- Structured facts used to render the body, kept for audit and for
  -- re-evaluation before send.
  payload         jsonb not null default '{}'::jsonb,
  body            text,
  -- Billable segment count. Bangla text is UCS-2, so a segment is 70
  -- characters rather than 160; computed by the application before queueing.
  segments        smallint check (segments is null or segments > 0),
  is_unicode      boolean not null default false,

  status          public.notification_status not null default 'pending',

  -- Earliest moment this job may be dispatched. For the daily summary this is
  -- the last scheduled period's end plus the configured grace period.
  scheduled_for   timestamptz,

  -- UNIQUE. This is the idempotency guarantee, not a convenience index.
  dedupe_key      text not null unique,

  attempts        smallint not null default 0 check (attempts >= 0),
  last_error      text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz,

  constraint notification_jobs_has_subject check (
    student_id is not null or teacher_id is not null
  )
);

create index notification_jobs_dispatch_idx
  on public.notification_jobs (scheduled_for)
  where status in ('pending', 'queued');

create index notification_jobs_student_idx
  on public.notification_jobs (student_id, job_date desc);

create index notification_jobs_status_idx
  on public.notification_jobs (status, created_at desc);

create trigger notification_jobs_touch_updated_at
  before update on public.notification_jobs
  for each row execute function app.touch_updated_at();

comment on column public.notification_jobs.dedupe_key is
  'Unique idempotency key, e.g. daily_attendance|<student>|<date>. One job per student per day.';
comment on column public.notification_jobs.segments is
  'Billable SMS segments. 160 chars per segment for GSM-7, 70 for Bangla/UCS-2.';

-- --------------------------------------------------------------------------
-- sms_delivery_logs — one row per provider attempt
-- --------------------------------------------------------------------------
-- Separate from the job so that retries are visible individually and so a
-- provider's reported cost is retained per attempt.
-- --------------------------------------------------------------------------
create table public.sms_delivery_logs (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.notification_jobs (id) on delete cascade,

  provider            text not null,
  -- 'simulate' records what WOULD have been sent without contacting anyone.
  mode                text not null default 'live' check (mode in ('live', 'simulate')),

  provider_message_id text,
  status              text,
  error_code          text,
  error_message       text,

  segments            smallint,
  cost                numeric(10,4),
  currency            text default 'BDT',

  -- The outbound request with any API key already stripped by the adapter.
  request_payload     jsonb,
  response_payload    jsonb,

  attempted_at        timestamptz not null default now()
);

create index sms_delivery_logs_job_idx on public.sms_delivery_logs (job_id, attempted_at desc);
create index sms_delivery_logs_provider_msg_idx
  on public.sms_delivery_logs (provider_message_id) where provider_message_id is not null;

comment on column public.sms_delivery_logs.mode is
  'simulate = nothing was actually sent. Keeps test runs distinguishable from live traffic.';
comment on column public.sms_delivery_logs.request_payload is
  'Outbound payload with credentials removed by the adapter before storage.';

-- --------------------------------------------------------------------------
-- otp_challenges — activation and password recovery
-- --------------------------------------------------------------------------
create table public.otp_challenges (
  id            uuid primary key default gen_random_uuid(),
  purpose       public.otp_purpose not null,

  -- Exactly one subject.
  student_id    uuid references public.students (id) on delete cascade,
  teacher_id    uuid references public.teachers (id) on delete cascade,

  phone         text not null check (phone ~ '^\+8801[3-9][0-9]{8}$'),

  -- Hash only. The plaintext code is never persisted.
  code_hash     text not null,

  expires_at    timestamptz not null,
  consumed_at   timestamptz,

  attempts      smallint not null default 0 check (attempts >= 0),
  max_attempts  smallint not null default 5 check (max_attempts > 0),

  -- Rate-limiting context.
  requested_ip  inet,
  created_at    timestamptz not null default now(),

  constraint otp_challenges_has_subject check (
    (student_id is not null) <> (teacher_id is not null)
  )
);

create index otp_challenges_lookup_idx
  on public.otp_challenges (phone, purpose, created_at desc);

create index otp_challenges_student_idx
  on public.otp_challenges (student_id, created_at desc) where student_id is not null;

create index otp_challenges_teacher_idx
  on public.otp_challenges (teacher_id, created_at desc) where teacher_id is not null;

-- At most one live challenge per subject per purpose at a time.
create unique index otp_challenges_single_live_student_idx
  on public.otp_challenges (student_id, purpose)
  where consumed_at is null and student_id is not null;

create unique index otp_challenges_single_live_teacher_idx
  on public.otp_challenges (teacher_id, purpose)
  where consumed_at is null and teacher_id is not null;

comment on table public.otp_challenges is
  'OTP state. Codes are stored hashed; plaintext never touches the database.';

-- --------------------------------------------------------------------------
-- auth_attempts — login and OTP rate limiting
-- --------------------------------------------------------------------------
create table public.auth_attempts (
  id           bigint generated always as identity primary key,
  -- Registration number, employee code, phone, or IP depending on the gate.
  identifier   text not null,
  kind         text not null check (kind in ('login', 'otp_request', 'otp_verify')),
  succeeded    boolean not null default false,
  ip_address   inet,
  user_agent   text,
  attempted_at timestamptz not null default now()
);

create index auth_attempts_rate_idx
  on public.auth_attempts (identifier, kind, attempted_at desc);

create index auth_attempts_ip_idx
  on public.auth_attempts (ip_address, attempted_at desc) where ip_address is not null;

comment on table public.auth_attempts is
  'Rate-limiting ledger for login and OTP. Written server-side only.';
