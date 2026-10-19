-- ===========================================================================
-- 0023  An SMS delivery log may exist without a notification job
-- ---------------------------------------------------------------------------
-- Found while testing the OTP flow against the hosted project.
--
-- sms_delivery_logs.job_id was NOT NULL, which assumed every message comes from
-- a queued notification_jobs row. That holds for the daily attendance summary
-- and for result notices, which are queued precisely so they can be made
-- idempotent — but it is wrong for account OTP.
--
-- An activation or password-reset code is sent synchronously, in response to
-- someone pressing a button, and is deliberately NOT queued: queueing it would
-- mean a code could be delivered minutes after it was requested, and would give
-- a retry mechanism to something that must not be retried.
--
-- The consequence of the constraint was that every OTP send failed to log.
-- In live mode that would have meant no delivery record and no cost record for
-- OTP traffic at all. In simulate mode it was worse in practice: the log is the
-- only place the simulated code appears, so activation could not be completed
-- or tested end to end.
--
-- job_id stays a foreign key, and stays required in spirit for queued traffic;
-- it is simply nullable now, with the delivery kind recorded in request_payload.
-- ===========================================================================

alter table public.sms_delivery_logs
  alter column job_id drop not null;

comment on column public.sms_delivery_logs.job_id is
  'The queued notification this delivery belongs to. NULL for synchronous sends such as account OTP, which are deliberately never queued.';

-- Finding a subject's recent OTP deliveries is a support question ("did the
-- code go out?"), so the un-jobbed rows get their own index rather than falling
-- back to a scan once the table is large.
create index if not exists sms_delivery_logs_unqueued_idx
  on public.sms_delivery_logs (attempted_at desc)
  where job_id is null;
