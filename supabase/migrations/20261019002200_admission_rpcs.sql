-- ===========================================================================
-- 0022  Atomic admission: create_student_record and create_teacher_record
-- ---------------------------------------------------------------------------
-- Admitting a student writes to four tables: students, student_private_ids,
-- student_contacts and student_enrollments. PostgREST has no transaction that
-- spans several requests, so doing this as four calls from a server action
-- would leave a half-admitted student behind whenever one of them failed —
-- a student with no guardian phone, or with no class.
--
-- These functions do the whole insert in one statement, so it either all
-- happens or none of it does.
--
-- They are SECURITY DEFINER, which means they bypass RLS, so each one checks
-- app.is_authority() itself as its first act. Without that check these would be
-- a way for any signed-in user to create students.
--
-- The auth identity is created separately, by the server action, because
-- passwords belong to Supabase Auth. The action generates the uuid first,
-- creates the auth user, then calls this function with both ids, and deletes
-- the auth user again if this call fails. That ordering is what makes the two
-- halves recoverable.
-- ===========================================================================

create or replace function public.create_student_record(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id   uuid := (p_payload ->> 'id')::uuid;
  v_actor        uuid := auth.uid();
  v_year_id      uuid := (p_payload ->> 'academic_year_id')::uuid;
  v_section_id   uuid := (p_payload ->> 'section_id')::uuid;
  v_class_id     uuid;
begin
  if not app.is_authority() then
    raise exception 'only the school authority may admit a student'
      using errcode = 'insufficient_privilege';
  end if;

  if v_student_id is null then
    raise exception 'id is required' using errcode = 'null_value_not_allowed';
  end if;

  -- The class is derived from the section rather than trusted from the client,
  -- so a payload cannot enroll a student into a class/section pair that does
  -- not actually belong together.
  select s.class_id into v_class_id
  from public.sections s
  where s.id = v_section_id;

  if v_class_id is null then
    raise exception 'unknown section' using errcode = 'foreign_key_violation';
  end if;

  insert into public.students (
    id, registration_no, full_name, full_name_bn, gender, date_of_birth,
    blood_group, father_name, mother_name, admitted_on, auth_user_id, created_by
  )
  values (
    v_student_id,
    btrim(p_payload ->> 'registration_no'),
    btrim(p_payload ->> 'full_name'),
    nullif(btrim(coalesce(p_payload ->> 'full_name_bn', '')), ''),
    (p_payload ->> 'gender')::public.gender,
    (p_payload ->> 'date_of_birth')::date,
    nullif(p_payload ->> 'blood_group', '')::public.blood_group,
    btrim(p_payload ->> 'father_name'),
    btrim(p_payload ->> 'mother_name'),
    coalesce((p_payload ->> 'admitted_on')::date, current_date),
    (p_payload ->> 'auth_user_id')::uuid,
    v_actor
  );

  -- At least one parent NID is required by a CHECK on this table.
  insert into public.student_private_ids (
    student_id, father_nid, mother_nid, birth_certificate_no
  )
  values (
    v_student_id,
    nullif(btrim(coalesce(p_payload ->> 'father_nid', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'mother_nid', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'birth_certificate_no', '')), '')
  );

  -- The guardian number. Not unique across students: siblings share one.
  insert into public.student_contacts (
    student_id, label, holder_name, phone, is_sms_target
  )
  values (
    v_student_id,
    coalesce(nullif(p_payload ->> 'contact_label', ''), 'guardian'),
    nullif(btrim(coalesce(p_payload ->> 'contact_holder_name', '')), ''),
    p_payload ->> 'guardian_phone',
    true
  );

  insert into public.student_enrollments (
    student_id, academic_year_id, class_id, section_id, roll_no, status, created_by
  )
  values (
    v_student_id,
    v_year_id,
    v_class_id,
    v_section_id,
    (p_payload ->> 'roll_no')::integer,
    'active',
    v_actor
  );

  return v_student_id;
end;
$$;

comment on function public.create_student_record(jsonb) is
  'Atomic student admission across four tables. Authority only; checks app.is_authority() itself.';

revoke all on function public.create_student_record(jsonb) from public, anon;
grant execute on function public.create_student_record(jsonb) to authenticated;

-- ===========================================================================
-- create_teacher_record
-- ---------------------------------------------------------------------------
-- Writes teachers, teacher_private_ids, any teacher_assignments supplied, and
-- optionally the fingerprint device mapping.
-- ===========================================================================
create or replace function public.create_teacher_record(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid := (p_payload ->> 'id')::uuid;
  v_actor      uuid := auth.uid();
  v_assignment jsonb;
  v_class_id   uuid;
  v_device_id  uuid := nullif(p_payload ->> 'device_id', '')::uuid;
begin
  if not app.is_authority() then
    raise exception 'only the school authority may add a teacher'
      using errcode = 'insufficient_privilege';
  end if;

  if v_teacher_id is null then
    raise exception 'id is required' using errcode = 'null_value_not_allowed';
  end if;

  insert into public.teachers (
    id, employee_code, full_name, full_name_bn, gender, blood_group,
    father_name, mother_name, personal_phone, alternate_phone, email,
    education, designation, joined_on, auth_user_id, created_by
  )
  values (
    v_teacher_id,
    btrim(p_payload ->> 'employee_code'),
    btrim(p_payload ->> 'full_name'),
    nullif(btrim(coalesce(p_payload ->> 'full_name_bn', '')), ''),
    (p_payload ->> 'gender')::public.gender,
    nullif(p_payload ->> 'blood_group', '')::public.blood_group,
    nullif(btrim(coalesce(p_payload ->> 'father_name', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'mother_name', '')), ''),
    p_payload ->> 'personal_phone',
    nullif(p_payload ->> 'alternate_phone', ''),
    nullif(btrim(coalesce(p_payload ->> 'email', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'education', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'designation', '')), ''),
    nullif(p_payload ->> 'joined_on', '')::date,
    (p_payload ->> 'auth_user_id')::uuid,
    v_actor
  );

  insert into public.teacher_private_ids (teacher_id, nid)
  values (v_teacher_id, btrim(p_payload ->> 'nid'));

  -- Assignments, if any were supplied. Each one derives its class from the
  -- section, as with student enrollment.
  for v_assignment in
    select * from jsonb_array_elements(coalesce(p_payload -> 'assignments', '[]'::jsonb))
  loop
    select s.class_id into v_class_id
    from public.sections s
    where s.id = (v_assignment ->> 'section_id')::uuid;

    if v_class_id is null then
      raise exception 'unknown section in assignment'
        using errcode = 'foreign_key_violation';
    end if;

    insert into public.teacher_assignments (
      teacher_id, academic_year_id, class_id, section_id, subject_id,
      effective_from, created_by
    )
    values (
      v_teacher_id,
      (v_assignment ->> 'academic_year_id')::uuid,
      v_class_id,
      (v_assignment ->> 'section_id')::uuid,
      (v_assignment ->> 'subject_id')::uuid,
      coalesce((v_assignment ->> 'effective_from')::date, current_date),
      v_actor
    );
  end loop;

  -- Fingerprint terminal mapping. The device user id is entered by the
  -- authority AFTER enrolling the teacher's fingers at the terminal itself;
  -- this row only records the mapping. No template is ever stored here, and
  -- this mapping alone transmits no attendance.
  if v_device_id is not null and nullif(p_payload ->> 'device_user_id', '') is not null then
    insert into public.device_users (
      device_id, device_user_id, teacher_id, enrolled_fingers,
      enrolled_at, enrolled_by, notes
    )
    values (
      v_device_id,
      btrim(p_payload ->> 'device_user_id'),
      v_teacher_id,
      coalesce((p_payload ->> 'enrolled_fingers')::smallint, 0),
      case when coalesce((p_payload ->> 'enrolled_fingers')::smallint, 0) > 0
           then now() end,
      v_actor,
      nullif(btrim(coalesce(p_payload ->> 'device_notes', '')), '')
    );
  end if;

  return v_teacher_id;
end;
$$;

comment on function public.create_teacher_record(jsonb) is
  'Atomic teacher creation with assignments and optional device mapping. Authority only.';

revoke all on function public.create_teacher_record(jsonb) from public, anon;
grant execute on function public.create_teacher_record(jsonb) to authenticated;

-- ===========================================================================
-- Search support
-- ---------------------------------------------------------------------------
-- The authority searches students by name or registration number. pg_trgm
-- makes a substring match on name use an index instead of scanning every row.
-- ===========================================================================
create extension if not exists pg_trgm with schema extensions;

create index if not exists students_name_trgm_gin_idx
  on public.students using gin (lower(full_name) extensions.gin_trgm_ops);

create index if not exists students_registration_trgm_idx
  on public.students using gin (lower(registration_no) extensions.gin_trgm_ops);

create index if not exists teachers_name_trgm_gin_idx
  on public.teachers using gin (lower(full_name) extensions.gin_trgm_ops);
