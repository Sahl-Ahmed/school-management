-- ===========================================================================
-- 0021  Make audit attribution survive account deletion
-- ---------------------------------------------------------------------------
-- Found while verifying the deployed project: an audit row written by an
-- authority account showed actor_id = NULL after that account was removed.
--
-- The cause was the foreign key:
--
--     actor_id uuid references public.profiles (id) on delete set null
--
-- combined with profiles.id cascading from auth.users. Deleting an auth user
-- therefore deleted the profile, which nulled actor_id on every audit row that
-- user had ever produced. The history survived; the attribution did not.
--
-- That is the wrong trade-off for an audit trail. The brief requires audit
-- records for changes to fees, marks, attendance, enrollment, permissions and
-- document eligibility, and a record that cannot say who made the change does
-- not satisfy it. Worse, it makes removing an account a way to launder it.
--
-- Fix: actor_id becomes a plain uuid with no foreign key, and the actor's name
-- and role are snapshotted at write time. An audit row is now self-contained.
--
-- Operationally, accounts should still be DEACTIVATED (profiles.is_active =
-- false) rather than deleted, so that operational references like created_by
-- and marked_by keep resolving. Those keep ON DELETE SET NULL deliberately:
-- they are convenience pointers, and audit_logs is the authoritative history.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Drop the foreign key. Keep the column and its data.
-- --------------------------------------------------------------------------
alter table public.audit_logs
  drop constraint if exists audit_logs_actor_id_fkey;

comment on column public.audit_logs.actor_id is
  'auth.users id of the acting user. Deliberately NOT a foreign key: attribution must survive account deletion.';

-- --------------------------------------------------------------------------
-- 2. Snapshot the actor's name alongside the id and role
-- --------------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists actor_name text;

comment on column public.audit_logs.actor_name is
  'The actor''s full_name as it was when the change was made. Snapshotted, not joined.';

-- --------------------------------------------------------------------------
-- 3. Teach the trigger to capture the name
-- --------------------------------------------------------------------------
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_role       public.user_role;
  v_name       text;
  v_old        jsonb;
  v_new        jsonb;
  v_changed    text[];
  v_record_id  text;
  v_key        text;
begin
  if v_actor is not null then
    select p.role, p.full_name
      into v_role, v_name
    from public.profiles p
    where p.id = v_actor;
  end if;

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_record_id := coalesce(v_old ->> 'id', '(unknown)');
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_record_id := coalesce(v_new ->> 'id', '(unknown)');
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_record_id := coalesce(v_new ->> 'id', '(unknown)');

    -- Record only genuinely changed columns, so an UPDATE that touches
    -- nothing does not produce a misleading entry.
    select coalesce(array_agg(k order by k), array[]::text[])
      into v_changed
    from (
      select key as k
      from jsonb_each(v_new)
      where not (key = any (app.audit_skip_columns()))
        and (v_old -> key) is distinct from (v_new -> key)
    ) diff;

    if array_length(v_changed, 1) is null then
      return new;
    end if;

    v_old := (select jsonb_object_agg(key, value)
              from jsonb_each(v_old) where key = any (v_changed));
    v_new := (select jsonb_object_agg(key, value)
              from jsonb_each(v_new) where key = any (v_changed));
  end if;

  -- Never copy a hashed secret into the audit table.
  foreach v_key in array app.audit_skip_columns() loop
    v_old := v_old - v_key;
    v_new := v_new - v_key;
  end loop;

  insert into public.audit_logs (
    actor_id, actor_role, actor_name, table_name, record_id, action,
    changed_fields, old_values, new_values
  )
  values (
    v_actor,
    v_role,
    v_name,
    tg_table_name,
    v_record_id,
    lower(tg_op)::public.audit_action,
    v_changed,
    v_old,
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function app.audit_row_change() is
  'Generic row-level audit trigger. Snapshots actor id, role and name so attribution outlives the account.';
