-- ===========================================================================
-- 0014  Audit log
-- ---------------------------------------------------------------------------
-- The brief requires audit records for changes to fees, marks, attendance,
-- enrollment, permissions and document eligibility. Rather than hand-writing
-- audit code in every server action — which is easy to forget — the record is
-- written by a database trigger, so a change made through any path is logged,
-- including one made directly in the Supabase SQL editor.
--
-- The actor is taken from auth.uid() when present. Work done by the service
-- role (schedulers, the K40 bridge) records a NULL actor with the context
-- column naming the process instead.
-- ===========================================================================

create table public.audit_logs (
  id             bigint generated always as identity primary key,

  actor_id       uuid references public.profiles (id) on delete set null,
  actor_role     public.user_role,
  -- Names a non-interactive process when actor_id is NULL, e.g. 'sms_dispatcher'.
  actor_context  text,

  table_name     text not null,
  record_id      text not null,
  action         public.audit_action not null,

  -- Only the columns that actually changed, for UPDATE.
  changed_fields text[],
  old_values     jsonb,
  new_values     jsonb,

  -- Set by application code for deliberate corrections that require a reason
  -- (attendance correction, punch correction, fee adjustment, mark reopen).
  reason         text,

  ip_address     inet,
  occurred_at    timestamptz not null default now()
);

create index audit_logs_record_idx
  on public.audit_logs (table_name, record_id, occurred_at desc);

create index audit_logs_actor_idx
  on public.audit_logs (actor_id, occurred_at desc);

create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);

comment on table public.audit_logs is
  'Append-only change history. Written by triggers so no code path can skip it.';

-- --------------------------------------------------------------------------
-- The generic audit trigger
-- --------------------------------------------------------------------------
-- Columns that are noise in an audit trail, or that must never be copied into
-- a second table.
create or replace function app.audit_skip_columns()
returns text[]
language sql
immutable
as $$
  select array['updated_at', 'created_at', 'code_hash']::text[];
$$;

create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_role       public.user_role;
  v_old        jsonb;
  v_new        jsonb;
  v_changed    text[];
  v_record_id  text;
  v_key        text;
begin
  if v_actor is not null then
    select role into v_role from public.profiles where id = v_actor;
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

    -- Keep only the changed keys in the stored snapshots.
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
    actor_id, actor_role, table_name, record_id, action,
    changed_fields, old_values, new_values
  )
  values (
    v_actor,
    v_role,
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
  'Generic row-level audit trigger. Logs changed columns only; skips hashed secrets.';

-- --------------------------------------------------------------------------
-- Attach the trigger to every table the brief requires audited
-- --------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_tables text[] := array[
    -- permissions and identity
    'profiles', 'students', 'student_private_ids', 'student_contacts',
    'student_enrollments', 'teachers', 'teacher_private_ids', 'teacher_assignments',
    -- attendance
    'teaching_sessions', 'student_attendance', 'teacher_daily_attendance',
    'device_users', 'leave_requests', 'cancelled_periods',
    -- academics
    'exams', 'exam_subjects', 'marks', 'mark_submissions', 'published_results',
    'class_tests', 'class_test_marks', 'grading_scales', 'grade_bands',
    -- money
    'fee_types', 'fee_rates', 'fee_charges', 'payments', 'payment_allocations',
    'receipts',
    -- eligibility and documents
    'admit_card_rules', 'admit_card_overrides', 'qr_tokens', 'document_templates',
    -- configuration
    'school_settings', 'academic_years', 'terms', 'classes', 'sections',
    'subjects', 'routine_periods', 'feedback_campaigns'
  ];
begin
  foreach v_table in array v_tables loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.audit_row_change()',
      'audit_' || v_table, v_table
    );
  end loop;
end;
$$;

-- Note: feedback_responses and feedback_comments are deliberately NOT audited.
-- An audit row carrying auth.uid() next to an anonymous rating would defeat the
-- anonymity the feedback model exists to guarantee.
