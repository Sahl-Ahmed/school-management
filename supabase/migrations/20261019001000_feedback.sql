-- ===========================================================================
-- 0010  Teacher feedback collected from students before each term
-- ---------------------------------------------------------------------------
-- Anonymity here is structural, not a matter of hiding a column in the UI.
--
--   feedback_completions — records THAT a student submitted (student_id present)
--   feedback_responses   — records WHAT was answered (NO student_id at all)
--   feedback_comments    — the optional free-text box (NO student_id at all)
--
-- There is no foreign key, and no column, linking a response or a comment back
-- to a student. Even a full database dump cannot attribute a rating. Double
-- submission is still prevented, because the completions table is what the
-- uniqueness constraint sits on.
--
-- The trade-off this buys: an individual rating can never be retracted or
-- corrected for one student, because nobody can find it again. That is the
-- intended behaviour.
-- ===========================================================================

create table public.feedback_campaigns (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references public.academic_years (id) on delete cascade,
  term_id           uuid not null references public.terms (id) on delete cascade,
  name              text not null,
  status            public.feedback_campaign_status not null default 'draft',

  opens_at          timestamptz,
  closes_at         timestamptz,

  -- When true, a student with incomplete feedback cannot be issued an admit
  -- card for exams in this term (brief section 4, admit-card eligibility).
  blocks_admit_card boolean not null default true,

  -- Minimum number of taught periods before a student is asked to review a
  -- teacher. Exact threshold is an owner decision (brief 12.5).
  min_periods_taught smallint not null default 1 check (min_periods_taught >= 0),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles (id) on delete set null,

  constraint feedback_campaigns_window_order check (
    opens_at is null or closes_at is null or closes_at > opens_at
  ),
  unique (term_id, name)
);

create trigger feedback_campaigns_touch_updated_at
  before update on public.feedback_campaigns
  for each row execute function app.touch_updated_at();

comment on column public.feedback_campaigns.blocks_admit_card is
  'If set, incomplete feedback blocks admit-card issue for this term''s exams.';

-- --------------------------------------------------------------------------
-- feedback_questions — 2-3 rating questions per teacher, plus the text box
-- --------------------------------------------------------------------------
-- The final question wording and scale are an owner decision (brief 12.6);
-- they are configuration, not code.
-- --------------------------------------------------------------------------
create table public.feedback_questions (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.feedback_campaigns (id) on delete cascade,
  prompt      text not null,
  prompt_bn   text,
  order_no    smallint not null check (order_no > 0),
  scale_min   smallint not null default 1 check (scale_min >= 0),
  scale_max   smallint not null default 5,
  created_at  timestamptz not null default now(),
  constraint feedback_questions_scale_order check (scale_max > scale_min),
  unique (campaign_id, order_no)
);

-- --------------------------------------------------------------------------
-- feedback_targets — which student is asked about which teacher
-- --------------------------------------------------------------------------
-- Generated from teacher_assignments when the campaign opens. Carries a
-- student_id because the student must be shown their own form; it carries no
-- answers.
-- --------------------------------------------------------------------------
create table public.feedback_targets (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.feedback_campaigns (id) on delete cascade,
  student_id    uuid not null references public.students (id) on delete cascade,
  teacher_id    uuid not null references public.teachers (id) on delete cascade,
  section_id    uuid not null references public.sections (id) on delete cascade,
  subject_id    uuid not null references public.subjects (id) on delete restrict,
  -- Periods this teacher actually taught this section for this subject in the
  -- term, used against campaigns.min_periods_taught.
  periods_taught integer not null default 0,
  -- Whether this particular target has been answered. Set together with the
  -- anonymous responses, in the same transaction, without storing which
  -- answers came from this row.
  answered_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (campaign_id, student_id, teacher_id, subject_id)
);

create index feedback_targets_student_idx
  on public.feedback_targets (campaign_id, student_id);

create index feedback_targets_pending_idx
  on public.feedback_targets (campaign_id, student_id)
  where answered_at is null;

comment on table public.feedback_targets is
  'The forms a student must fill. answered_at marks completion; answers are elsewhere.';

-- --------------------------------------------------------------------------
-- feedback_completions — completion tracked separately from answers
-- --------------------------------------------------------------------------
create table public.feedback_completions (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.feedback_campaigns (id) on delete cascade,
  student_id     uuid not null references public.students (id) on delete cascade,
  targets_total  integer not null default 0,
  targets_done   integer not null default 0,
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (campaign_id, student_id)
);

create index feedback_completions_complete_idx
  on public.feedback_completions (campaign_id, student_id)
  where completed_at is not null;

create trigger feedback_completions_touch_updated_at
  before update on public.feedback_completions
  for each row execute function app.touch_updated_at();

comment on table public.feedback_completions is
  'Who has finished. Deliberately holds no answers, so it can name students safely.';

-- --------------------------------------------------------------------------
-- feedback_responses — anonymous ratings
-- --------------------------------------------------------------------------
create table public.feedback_responses (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.feedback_campaigns (id) on delete cascade,
  -- Who is being rated, and in what context. Never who is rating.
  teacher_id  uuid not null references public.teachers (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete restrict,
  section_id  uuid not null references public.sections (id) on delete cascade,
  question_id uuid not null references public.feedback_questions (id) on delete cascade,
  rating      smallint not null,
  -- Deliberately coarse: the date, not the timestamp, so submission order
  -- cannot be correlated against the completions table to re-identify anyone.
  submitted_on date not null default (now() at time zone 'Asia/Dhaka')::date
);

create index feedback_responses_analysis_idx
  on public.feedback_responses (campaign_id, teacher_id, question_id);

comment on table public.feedback_responses is
  'Anonymous ratings. There is deliberately no student reference on this table.';
comment on column public.feedback_responses.submitted_on is
  'Date only. A full timestamp would allow re-identification via feedback_completions.';

create table public.feedback_comments (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.feedback_campaigns (id) on delete cascade,
  teacher_id  uuid not null references public.teachers (id) on delete cascade,
  subject_id  uuid references public.subjects (id) on delete set null,
  section_id  uuid not null references public.sections (id) on delete cascade,
  body        text not null check (length(btrim(body)) > 0),
  submitted_on date not null default (now() at time zone 'Asia/Dhaka')::date
);

create index feedback_comments_teacher_idx
  on public.feedback_comments (campaign_id, teacher_id);

comment on table public.feedback_comments is
  'Optional praise/complaint text. Anonymous by construction; authority-visible only.';

-- A rating must fall inside the scale its own question declares.
create or replace function app.enforce_rating_within_scale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min smallint;
  v_max smallint;
begin
  select scale_min, scale_max into v_min, v_max
  from public.feedback_questions
  where id = new.question_id;

  if new.rating < v_min or new.rating > v_max then
    raise exception 'rating % is outside this question''s scale (%..%)',
      new.rating, v_min, v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger feedback_responses_rating_in_scale
  before insert or update of rating on public.feedback_responses
  for each row execute function app.enforce_rating_within_scale();
