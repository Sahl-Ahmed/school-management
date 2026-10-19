-- ===========================================================================
-- 0002  Profiles (one row per auth user) and shared trigger utilities
-- ---------------------------------------------------------------------------
-- Every authenticated user — authority, teacher and student alike — has
-- exactly one profile row keyed by their auth.users id. The profile carries
-- the role, and the role is what every RLS policy resolves against.
--
-- Passwords are never stored here. Supabase Auth owns credentials; this table
-- only records whether the account still needs to set its first password.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Shared: keep updated_at honest without trusting the client
-- --------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.touch_updated_at() is
  'BEFORE UPDATE trigger: sets updated_at to now(), ignoring any client value.';

-- --------------------------------------------------------------------------
-- profiles
-- --------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  role              public.user_role not null,
  full_name         text not null check (length(btrim(full_name)) > 0),
  -- Set false to lock an account out without deleting its history.
  is_active         boolean not null default true,
  -- True from creation until the user completes OTP activation and chooses a
  -- password. Checked by middleware so an un-activated account cannot browse.
  must_set_password boolean not null default true,
  activated_at      timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role) where is_active;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

comment on table public.profiles is
  'Role and activation state for every auth user. Credentials live in auth.users.';
comment on column public.profiles.must_set_password is
  'Account provisioned by authority but not yet activated via OTP + chosen password.';
