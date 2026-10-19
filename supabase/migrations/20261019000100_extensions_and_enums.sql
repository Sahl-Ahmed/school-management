-- ===========================================================================
-- 0001  Extensions, schemas and enumerated types
-- ---------------------------------------------------------------------------
-- btree_gist is required by the exclusion constraints that stop a teacher or
-- a class being double-booked in the routine, and that stop overlapping
-- effective-dated teacher assignments.
-- ===========================================================================

-- Exclusion-constraint operator classes come from btree_gist, which Supabase
-- keeps in the `extensions` schema. Every migration that declares an exclusion
-- constraint repeats this search_path so it does not depend on role defaults.
set search_path = public, extensions, pg_catalog;

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "btree_gist" with schema extensions;

-- Helper/authorisation functions live in their own schema so that policy code
-- is obvious at a glance and so nothing here is mistaken for a data table.
create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- timerange — Postgres ships int4/int8/num/ts/tstz/date ranges but no range
-- over `time`. The routine needs one to express "this period occupies 09:00
-- to 09:45 on Sunday" as something an exclusion constraint can overlap-test.
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'timerange') then
    create type public.timerange as range (subtype = time);
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- Roles and people
-- --------------------------------------------------------------------------
create type public.user_role as enum (
  'authority_admin',  -- full school-wide privileges
  'authority_staff',  -- office staff: narrower management actions
  'teacher',
  'student'
);

create type public.gender as enum ('male', 'female', 'other');

create type public.blood_group as enum ('A+','A-','B+','B-','O+','O-','AB+','AB-');

create type public.enrollment_status as enum (
  'active', 'promoted', 'transferred', 'withdrawn', 'graduated'
);

-- --------------------------------------------------------------------------
-- Attendance
-- --------------------------------------------------------------------------
-- NOTE: there is deliberately no 'not_submitted' value here. A lesson whose
-- teacher has not submitted attendance has NO student_attendance rows at all;
-- absence is only ever recorded explicitly. See teaching_sessions.submitted_at.
create type public.attendance_status as enum ('present', 'absent', 'late', 'excused');

create type public.teacher_day_status as enum (
  'present', 'absent', 'late', 'approved_leave', 'holiday', 'weekend', 'no_data'
);

create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');

-- --------------------------------------------------------------------------
-- Academics
-- --------------------------------------------------------------------------
create type public.term_status as enum ('upcoming', 'active', 'closed');

create type public.exam_status as enum (
  'draft',        -- authority is still configuring subjects / dates
  'scheduled',    -- routine published, marks not open
  'marks_open',   -- teachers may enter marks
  'marks_closed', -- entry locked, authority reviewing
  'published'     -- results visible to students; result SMS allowed
);

create type public.class_test_status as enum ('draft', 'marks_entered', 'sent');

-- --------------------------------------------------------------------------
-- Fees
-- --------------------------------------------------------------------------
create type public.fee_charge_status as enum (
  'pending', 'partial', 'paid', 'waived', 'cancelled'
);

create type public.payment_method as enum (
  'cash', 'bkash', 'nagad', 'rocket', 'bank', 'cheque', 'other'
);

-- --------------------------------------------------------------------------
-- Feedback
-- --------------------------------------------------------------------------
create type public.feedback_campaign_status as enum ('draft', 'open', 'closed');

-- --------------------------------------------------------------------------
-- Documents
-- --------------------------------------------------------------------------
create type public.document_kind as enum (
  'admit_card', 'id_card', 'seat_token', 'result_sheet', 'fee_receipt',
  'class_routine', 'school_routine'
);

create type public.card_orientation as enum ('portrait', 'landscape');

-- --------------------------------------------------------------------------
-- Notifications / SMS
-- --------------------------------------------------------------------------
create type public.notification_type as enum (
  'daily_attendance',
  'exam_result',
  'class_test_result',
  'account_otp',
  'attendance_correction',
  'custom'
);

create type public.notification_status as enum (
  'pending',   -- job row created, not yet eligible to send
  'queued',    -- eligible, waiting for the dispatcher
  'sent',
  'failed',
  'cancelled',
  'skipped'    -- e.g. holiday, or no contact on record
);

create type public.otp_purpose as enum ('activation', 'password_reset', 'phone_change');

create type public.audit_action as enum ('insert', 'update', 'delete');
