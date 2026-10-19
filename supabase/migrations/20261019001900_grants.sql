-- ===========================================================================
-- 0019  Explicit privilege grants
-- ---------------------------------------------------------------------------
-- Supabase grants table privileges to `anon` and `authenticated` by default and
-- relies on RLS alone to restrict them. This migration states the grants
-- explicitly instead, for two reasons:
--
--   1. `anon` is granted nothing on any table. An anonymous visitor reaches
--      exactly one thing — get_public_card() — and a missing policy therefore
--      cannot widen the public surface by accident.
--   2. The grants are part of the migration history, so a fresh project, a
--      restored backup and the test harness all end up with the same
--      privileges rather than inheriting whatever the platform defaults were.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Start from nothing rather than from the platform default.
-- --------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- --------------------------------------------------------------------------
-- authenticated: full DML, gated entirely by the policies in 0016.
-- --------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- --------------------------------------------------------------------------
-- Tables no interactive user may write, whatever their role.
-- ---------------------------------------------------------------------------
-- These are service-role territory: the SMS dispatcher, the OTP issuer, the
-- rate limiter, the K40 bridge, and the audit trigger. Revoking the privilege
-- outright means a policy mistake cannot make them writable.
-- --------------------------------------------------------------------------
revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.otp_challenges from authenticated;
revoke insert, update, delete on public.auth_attempts from authenticated;
revoke insert, update, delete on public.raw_punch_events from authenticated;
revoke insert, update, delete on public.sms_delivery_logs from authenticated;

-- The authority inspects pending/sent/failed messages but does not hand-edit
-- the queue; cancelling a job goes through a server action under the service role.
revoke insert, delete on public.notification_jobs from authenticated;

-- OTP state and the rate-limit ledger are not readable by any signed-in user.
revoke select on public.otp_challenges from authenticated;
revoke select on public.auth_attempts from authenticated;

-- --------------------------------------------------------------------------
-- anon: no table privileges at all.
-- --------------------------------------------------------------------------
-- Deliberately empty. The single anonymous entry point is
-- public.get_public_card(text), granted in migration 0015.
--
-- storage.objects keeps its own platform grants; the public `branding` bucket
-- is reachable through the Storage API, not through SQL.
