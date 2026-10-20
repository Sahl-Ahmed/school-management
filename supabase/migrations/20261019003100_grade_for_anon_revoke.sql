-- ===========================================================================
-- 0031  Revoke anon's EXECUTE on app.grade_for
-- ---------------------------------------------------------------------------
-- The same trap migration 0020 was written for, hit again by a function added
-- afterwards.
--
-- Supabase's database has DEFAULT PRIVILEGES that grant EXECUTE on every new
-- function in these schemas to `anon` BY NAME. A `grant execute ... to
-- authenticated` does not displace that, and `revoke ... from public` does not
-- either, because the grant is not held by the PUBLIC pseudo-role. So
-- app.grade_for — added in 0030 with only a grant to `authenticated` — was
-- left callable by an unauthenticated caller.
--
-- What that exposed is small: the function is SECURITY DEFINER and returns the
-- grade, point and pass flag for a percentage on a given scale, so a caller
-- who already knew a scale's id could read back the school's grading bands.
-- No student data, no marks. It is still a privilege nobody outside the school
-- should hold, and `npm run report:remote-schema` is the check that found it.
--
-- Every other function 0030 added carries its own `revoke all ... from public,
-- anon` line; this one did not. The lesson is in docs/decisions-for-owner.md:
-- a new function needs the explicit revoke, every time.
-- ===========================================================================

revoke all on function app.grade_for(uuid, numeric) from public, anon;
grant execute on function app.grade_for(uuid, numeric) to authenticated;
