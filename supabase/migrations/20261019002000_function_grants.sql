-- ===========================================================================
-- 0020  Function execution privileges
-- ---------------------------------------------------------------------------
-- Fixes a real hole found by auditing the deployed project rather than the
-- local harness.
--
-- Migration 0015 did:
--
--     revoke all on function public.admit_card_eligibility(uuid, uuid) from public;
--     grant execute on function public.admit_card_eligibility(uuid, uuid) to authenticated;
--
-- and that was not enough. Supabase configures ALTER DEFAULT PRIVILEGES so that
-- a newly created function in `public` is granted EXECUTE to anon, authenticated
-- and service_role EXPLICITLY. `revoke ... from public` removes only the PUBLIC
-- pseudo-role grant; the explicit grant to `anon` survives untouched.
--
-- The deployed project therefore let an anonymous caller execute every function
-- in `public`, including admit_card_eligibility — which, given a student uuid,
-- reports that student's outstanding fees and whether their feedback is
-- incomplete. Student uuids are not published anywhere, and feedback_analysis
-- and submit_feedback both re-check authorisation internally, so nothing was
-- actually leaking. It was still one guessed identifier away from a real
-- disclosure, and it contradicts the stated rule that `anon` reaches exactly
-- one function.
--
-- This migration takes the same posture for functions that 0019 took for
-- tables: revoke everything, then re-grant only what is needed, naming each one.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Start from nothing
-- --------------------------------------------------------------------------
-- Note this revokes from `anon` and `authenticated` BY NAME, not just from
-- PUBLIC, which is the mistake 0015 made.
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;

-- Stop future migrations from reintroducing the same grant. Default privileges
-- apply per granting role, and migrations run as `postgres`, so this covers
-- every function added from here on.
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema app revoke all on functions from anon, authenticated;

-- An anonymous caller has no business reaching into the helper schema at all.
-- PostgREST exposes only `public`, so this was not reachable over the API, but
-- exposing `app` in the API settings later must not silently open it.
revoke usage on schema app from anon;

-- --------------------------------------------------------------------------
-- 2. The single anonymous entry point
-- --------------------------------------------------------------------------
grant execute on function public.get_public_card(text) to anon, authenticated;

-- --------------------------------------------------------------------------
-- 3. Signed-in callers
-- --------------------------------------------------------------------------
grant execute on function public.admit_card_eligibility(uuid, uuid) to authenticated;
grant execute on function public.submit_feedback(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.feedback_analysis(uuid, integer) to authenticated;

-- --------------------------------------------------------------------------
-- 4. Authorisation helpers used inside RLS policies
-- ---------------------------------------------------------------------------
-- A policy expression is evaluated with the privileges of the querying user,
-- so `authenticated` must be able to execute every helper a policy calls.
-- Without these grants every query against a policied table fails with
-- "permission denied for function", which the local test suite catches
-- immediately.
-- --------------------------------------------------------------------------
grant usage on schema app to authenticated;

grant execute on function app.caller_role() to authenticated;
grant execute on function app.is_authority() to authenticated;
grant execute on function app.is_admin() to authenticated;
grant execute on function app.is_teacher() to authenticated;
grant execute on function app.is_student() to authenticated;
grant execute on function app.current_student_id() to authenticated;
grant execute on function app.current_teacher_id() to authenticated;
grant execute on function app.current_student_section_id() to authenticated;
grant execute on function app.teaches_section(uuid, date) to authenticated;
grant execute on function app.teaches_section_subject(uuid, uuid, date) to authenticated;
grant execute on function app.teaches_student(uuid) to authenticated;
grant execute on function app.owns_teaching_session(uuid) to authenticated;
grant execute on function app.may_enter_marks(uuid) to authenticated;
grant execute on function app.owns_student_record(uuid) to authenticated;

-- Called by server code when issuing a receipt.
grant execute on function app.next_receipt_no() to authenticated;

-- --------------------------------------------------------------------------
-- 5. Deliberately NOT granted to anyone
-- ---------------------------------------------------------------------------
-- Trigger functions. PostgreSQL checks EXECUTE on a trigger function when the
-- trigger is CREATED, not each time it fires, so the firing user needs no
-- grant. They run as the table owner and must not be callable directly:
--
--   app.audit_row_change, app.audit_skip_columns, app.touch_updated_at,
--   app.enforce_marks_within_max, app.enforce_class_test_marks_within_max,
--   app.enforce_rating_within_scale, app.enforce_qr_snapshot_safe,
--   app.enforce_allocation_within_payment, app.payment_allocations_sync,
--   app.payments_reversal_sync, app.recalc_fee_charge
--
-- `service_role` keeps the explicit grants Supabase's default privileges gave
-- it; nothing above revokes from it, because the schedulers, the SMS
-- dispatcher and the K40 bridge run under it.
-- --------------------------------------------------------------------------
