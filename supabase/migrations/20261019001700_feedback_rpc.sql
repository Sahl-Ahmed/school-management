-- ===========================================================================
-- 0017  submit_feedback() — the only way a student writes feedback
-- ---------------------------------------------------------------------------
-- Students hold no INSERT policy on feedback_responses or feedback_comments.
-- All writing happens here, inside one transaction, because the anonymity
-- model depends on two things happening together and neither alone:
--
--   * the anonymous ratings are inserted with no student reference
--   * the student's target row is marked answered, and their completion
--     counter advanced
--
-- Doing this from client code would risk a crash between the two writes,
-- leaving either a student who can submit twice or a student permanently
-- unable to finish. The function also means the client cannot choose which
-- teacher a rating is attributed to: that comes from the target row.
-- ===========================================================================

create or replace function public.submit_feedback(
  p_campaign_id uuid,
  p_target_id   uuid,
  -- [{ "question_id": "...", "rating": 4 }, ...]
  p_ratings     jsonb,
  p_comment     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id   uuid := app.current_student_id();
  v_campaign     public.feedback_campaigns%rowtype;
  v_target       public.feedback_targets%rowtype;
  v_rating       jsonb;
  v_question_ids uuid[];
  v_expected     integer;
  v_total        integer;
  v_done         integer;
begin
  if v_student_id is null then
    raise exception 'only a signed-in student may submit feedback'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_campaign
  from public.feedback_campaigns
  where id = p_campaign_id;

  if not found then
    raise exception 'feedback campaign not found' using errcode = 'no_data_found';
  end if;

  if v_campaign.status <> 'open'
     or (v_campaign.opens_at is not null and now() < v_campaign.opens_at)
     or (v_campaign.closes_at is not null and now() > v_campaign.closes_at) then
    raise exception 'this feedback campaign is not open'
      using errcode = 'check_violation';
  end if;

  -- The target row is the authority on who is being rated. Locking it is what
  -- makes a double submission from two concurrent requests impossible.
  select * into v_target
  from public.feedback_targets
  where id = p_target_id
    and campaign_id = p_campaign_id
    and student_id = v_student_id
  for update;

  if not found then
    -- Deliberately the same message whether the target belongs to someone else
    -- or does not exist, so this cannot be used to probe other students.
    raise exception 'no such feedback form for this student'
      using errcode = 'no_data_found';
  end if;

  if v_target.answered_at is not null then
    raise exception 'this feedback form has already been submitted'
      using errcode = 'unique_violation';
  end if;

  if v_target.periods_taught < v_campaign.min_periods_taught then
    raise exception 'this teacher has not taught enough periods to be reviewed'
      using errcode = 'check_violation';
  end if;

  -- Every rating question in the campaign must be answered exactly once.
  select array_agg(id), count(*)
    into v_question_ids, v_expected
  from public.feedback_questions
  where campaign_id = p_campaign_id;

  if jsonb_array_length(p_ratings) <> v_expected then
    raise exception 'expected % ratings, received %',
      v_expected, jsonb_array_length(p_ratings)
      using errcode = 'check_violation';
  end if;

  -- --- the anonymous half -------------------------------------------------
  for v_rating in select * from jsonb_array_elements(p_ratings)
  loop
    if not ((v_rating ->> 'question_id')::uuid = any (v_question_ids)) then
      raise exception 'question % does not belong to this campaign',
        v_rating ->> 'question_id'
        using errcode = 'check_violation';
    end if;

    insert into public.feedback_responses (
      campaign_id, teacher_id, subject_id, section_id, question_id, rating
    )
    values (
      p_campaign_id,
      v_target.teacher_id,   -- taken from the target, never from the client
      v_target.subject_id,
      v_target.section_id,
      (v_rating ->> 'question_id')::uuid,
      (v_rating ->> 'rating')::smallint
    );
  end loop;

  if p_comment is not null and length(btrim(p_comment)) > 0 then
    insert into public.feedback_comments (
      campaign_id, teacher_id, subject_id, section_id, body
    )
    values (
      p_campaign_id, v_target.teacher_id, v_target.subject_id,
      v_target.section_id, btrim(p_comment)
    );
  end if;

  -- --- the identified half ------------------------------------------------
  update public.feedback_targets
     set answered_at = now()
   where id = p_target_id;

  select count(*), count(*) filter (where answered_at is not null)
    into v_total, v_done
  from public.feedback_targets
  where campaign_id = p_campaign_id
    and student_id = v_student_id;

  insert into public.feedback_completions (
    campaign_id, student_id, targets_total, targets_done, completed_at
  )
  values (
    p_campaign_id, v_student_id, v_total, v_done,
    case when v_done >= v_total then now() end
  )
  on conflict (campaign_id, student_id) do update
    set targets_total = excluded.targets_total,
        targets_done  = excluded.targets_done,
        completed_at  = case
                          when excluded.targets_done >= excluded.targets_total
                          then coalesce(public.feedback_completions.completed_at, now())
                        end;

  return jsonb_build_object(
    'submitted', true,
    'targets_total', v_total,
    'targets_done', v_done,
    'campaign_complete', v_done >= v_total
  );
end;
$$;

comment on function public.submit_feedback(uuid, uuid, jsonb, text) is
  'Atomic feedback submission. Ratings are stored with no student reference; only completion is.';

revoke all on function public.submit_feedback(uuid, uuid, jsonb, text) from public;
grant execute on function public.submit_feedback(uuid, uuid, jsonb, text) to authenticated;

-- ===========================================================================
-- Feedback analysis for the authority
-- ---------------------------------------------------------------------------
-- Aggregated per teacher and question. A small-sample floor is applied so that
-- a section where only one or two students answered cannot be used to work out
-- who said what. The floor is advisory for the authority's own analysis and is
-- returned alongside the data rather than silently hiding it.
-- ===========================================================================
create or replace function public.feedback_analysis(
  p_campaign_id uuid,
  p_min_responses integer default 3
)
returns table (
  teacher_id        uuid,
  teacher_name      text,
  question_id       uuid,
  prompt            text,
  response_count    bigint,
  average_rating    numeric,
  below_sample_floor boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.teacher_id,
    t.full_name,
    r.question_id,
    q.prompt,
    count(*) as response_count,
    round(avg(r.rating)::numeric, 2) as average_rating,
    count(*) < p_min_responses as below_sample_floor
  from public.feedback_responses r
  join public.teachers t on t.id = r.teacher_id
  join public.feedback_questions q on q.id = r.question_id
  where r.campaign_id = p_campaign_id
    and app.is_authority()
  group by r.teacher_id, t.full_name, r.question_id, q.prompt
  order by t.full_name, q.prompt;
$$;

comment on function public.feedback_analysis(uuid, integer) is
  'Authority-only aggregate. Flags small samples that could allow re-identification.';

revoke all on function public.feedback_analysis(uuid, integer) from public;
grant execute on function public.feedback_analysis(uuid, integer) to authenticated;
