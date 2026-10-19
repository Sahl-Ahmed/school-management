-- ===========================================================================
-- 0026  Restore EXECUTE on the custom range constructors
-- ---------------------------------------------------------------------------
-- A real bug introduced by migration 0020 and found by inserting a routine
-- period as `authenticated` for the first time in Phase 3.
--
-- 0020 revoked EXECUTE on ALL functions in `public` from `authenticated`, then
-- re-granted the handful that are meant to be callable. That was right for the
-- RPCs — but `public.timerange` is not an RPC. It is the constructor that
-- `CREATE TYPE ... AS RANGE` generates for the custom range type in migration
-- 0001, and the exclusion constraints on routine_periods call it:
--
--     exclude using gist (
--       section_id with =, weekday with =,
--       timerange(starts_at, ends_at, '[)') with &&,  <-- here
--       daterange(effective_from, effective_to, '[]') with &&
--     )
--
-- A constraint expression is evaluated with the privileges of the user
-- performing the write, not the table owner. So every attempt by the authority
-- to add a routine period failed with:
--
--     permission denied for function timerange
--
-- It went unnoticed in Phases 1 and 2 because the only exclusion constraints
-- exercised there used `daterange`, which is a built-in in pg_catalog and was
-- never revoked, and because teacher_assignments are inserted inside a
-- SECURITY DEFINER function that runs as the owner.
--
-- The fix grants EXECUTE on the range constructors specifically. They are pure
-- value constructors over `time` — they read nothing and expose nothing — so
-- this widens the surface by nothing meaningful, which is why 0020's blanket
-- revoke was the wrong instrument for them.
--
-- anon is deliberately NOT granted: anonymous callers never write.
-- ===========================================================================

do $$
declare
  v_fn record;
begin
  -- Every overload the range type generated: timerange(time, time),
  -- timerange(time, time, text), and the matching multirange constructors.
  for v_fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('timerange', 'timemultirange')
  loop
    execute format('grant execute on function %s to authenticated', v_fn.signature);
  end loop;
end;
$$;

comment on type public.timerange is
  'Range over `time`, used by the routine exclusion constraints. authenticated needs EXECUTE on its constructors because a constraint expression runs as the writing user.';
