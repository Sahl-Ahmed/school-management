-- ===========================================================================
-- 0034  Correct what issue_qr_token says about the guardian's phone number
-- ---------------------------------------------------------------------------
-- Migration 0033 shipped with a comment inside this function claiming that the
-- guardian's number, having been printed on the card, "therefore appears on the
-- public page". The phase 6 browser walkthrough showed that it does not: the
-- public /card/<token> page renders a deliberate subset of the snapshot and
-- leaves that field out.
--
-- The behaviour is the one we want — a finder holding a lost card reads the
-- number off the plastic, and scanning the QR does not hand it to anyone who
-- never touched the card. What was wrong was the comment, and a comment that
-- misdescribes a privacy behaviour is worth a migration: it lives in the
-- deployed function body, where the next person to read `\df+` will believe it.
--
-- Nothing executable changes here. The body is byte-identical to 0033 apart
-- from that comment, and the function's COMMENT now states where the number
-- does and does not appear.
-- ===========================================================================

create or replace function public.issue_qr_token(
  p_student_id uuid,
  p_token text,
  p_template_id uuid default null,
  p_replacing_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.document_templates%rowtype;
  v_fields   text[];
  v_snapshot jsonb := '{}'::jsonb;
  v_old      public.qr_tokens%rowtype;
  v_new_id   uuid;
  v_student  record;
begin
  if not app.is_authority() then
    raise exception 'only the school office may issue an ID card'
      using errcode = 'insufficient_privilege';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'the card token must be at least 32 characters'
      using errcode = 'check_violation';
  end if;

  select * into v_template
  from public.document_templates
  where id = coalesce(
    p_template_id,
    (select id from public.document_templates
      where kind = 'id_card' and is_default and is_active limit 1)
  );

  if not found then
    raise exception 'no ID card template is configured' using errcode = 'no_data_found';
  end if;

  select
    st.full_name, st.full_name_bn, st.registration_no, st.blood_group,
    st.photo_path, se.roll_no, c.name as class_name, sec.name as section_name,
    ay.name as session_name,
    (select sc.phone from public.student_contacts sc
      where sc.student_id = st.id
      order by sc.is_sms_target desc, sc.created_at
      limit 1) as guardian_phone
  into v_student
  from public.students st
  join public.student_enrollments se
    on se.student_id = st.id and se.status = 'active'
  join public.academic_years ay
    on ay.id = se.academic_year_id and ay.is_current
  join public.sections sec on sec.id = se.section_id
  join public.classes c on c.id = sec.class_id
  where st.id = p_student_id;

  if not found then
    raise exception 'that student has no active enrollment in the current year'
      using errcode = 'no_data_found';
  end if;

  -- The template decides the contents. Anything not named here is not copied,
  -- so widening the public surface means editing a template row, which is
  -- visible and auditable, rather than editing a query nobody re-reads.
  v_fields := coalesce(
    array(select jsonb_array_elements_text(v_template.config -> 'front_fields')),
    array[]::text[]
  ) || coalesce(
    array(select jsonb_array_elements_text(v_template.config -> 'back_fields')),
    array[]::text[]
  );

  if 'full_name' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('full_name', v_student.full_name);
  end if;
  if 'full_name_bn' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('full_name_bn', v_student.full_name_bn);
  end if;
  if 'registration_no' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('registration_no', v_student.registration_no);
  end if;
  if 'class_name' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('class_name', v_student.class_name);
  end if;
  if 'section_name' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('section_name', v_student.section_name);
  end if;
  if 'roll_no' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('roll_no', v_student.roll_no);
  end if;
  if 'blood_group' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('blood_group', v_student.blood_group);
  end if;
  if 'session' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('session', v_student.session_name);
  end if;
  if 'photo' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('photo_path', v_student.photo_path);
  end if;
  -- The owner chose to print this on the card. It is kept in the snapshot so
  -- the printed card can be generated from it; the public page deliberately
  -- does not render it. See this migration's header.
  if 'guardian_phone' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('guardian_phone', v_student.guardian_phone);
  end if;

  /*
   * Revoke the live card BEFORE inserting the replacement.
   *
   * The order matters and is not cosmetic: qr_tokens_single_active_idx is a
   * unique index on (student_id) WHERE revoked_at IS NULL, so inserting the new
   * row while the old one is still live violates it immediately — which made
   * reissuing a lost card impossible until this was reordered. The
   * replaced_by_id link is set afterwards, once the new row has an id.
   */
  select * into v_old
  from public.qr_tokens
  where student_id = p_student_id and revoked_at is null
  for update;

  if v_old.id is not null then
    update public.qr_tokens
       set revoked_at = now(),
           revoked_by = auth.uid(),
           revoke_reason = coalesce(
             nullif(btrim(coalesce(p_replacing_reason, '')), ''),
             'replaced by a newly issued card'
           )
     where id = v_old.id;
  end if;

  insert into public.qr_tokens (
    token, student_id, template_id, card_snapshot, issued_by
  )
  values (p_token, p_student_id, v_template.id, v_snapshot, auth.uid())
  returning id into v_new_id;

  if v_old.id is not null then
    update public.qr_tokens set replaced_by_id = v_new_id where id = v_old.id;
  end if;

  insert into public.generated_documents (kind, template_id, student_id, meta, generated_by)
  values ('id_card', v_template.id, p_student_id,
          jsonb_build_object('qr_token_id', v_new_id, 'replaced', v_old.id is not null),
          auth.uid());

  return jsonb_build_object(
    'qr_token_id', v_new_id,
    'replaced_previous', v_old.id is not null,
    'fields', (select jsonb_agg(k) from jsonb_object_keys(v_snapshot) k)
  );
end;
$$;

comment on function public.issue_qr_token(uuid, text, uuid, text) is
  'Issues a public card link. The snapshot carries the template''s declared fields and issuing revokes the previous card. The guardian phone, when declared, is printed on the physical card but is NOT rendered by the public /card/<token> page.';

revoke all on function public.issue_qr_token(uuid, text, uuid, text) from public, anon;
grant execute on function public.issue_qr_token(uuid, text, uuid, text) to authenticated;
