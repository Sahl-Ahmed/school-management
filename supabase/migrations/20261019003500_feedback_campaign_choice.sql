-- ===========================================================================
-- 0035  Pick the RIGHT feedback round when a term has more than one
-- ---------------------------------------------------------------------------
-- Both default_admit_card_rule (0033) and admit_card_eligibility (0015)
-- resolved "the feedback round that gates this exam" with
--
--     order by created_at limit 1
--
-- which picks the OLDEST round in the term. Nothing wrong with that while a
-- term has exactly one, which is the normal case — but a term can easily end
-- up with two: a round created by mistake and abandoned as a draft, a re-run
-- after the questions were wrong, or a second round for a late cohort. The
-- oldest is then precisely the wrong answer: an abandoned draft nobody can
-- complete would gate every admit card in the term, and no screen would
-- explain why.
--
-- Found when the phase 6 verification suite and a browser walkthrough each
-- created a round in the same term and the admit-card verdict started
-- depending on which had been made first.
--
-- The order this uses instead:
--   1. an OPEN round — the one students are being asked to fill in now;
--   2. otherwise a CLOSED round — the term's feedback has been and gone;
--   3. otherwise the most recent draft.
-- Within each, the most recently created, because that is the one the office
-- most recently meant.
--
-- Both functions get the same rule, so the gate and the rule that configures it
-- can never disagree about which round they mean.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- One definition of "the round that gates this term", used by both callers.
-- --------------------------------------------------------------------------
create or replace function app.gating_feedback_campaign(p_term_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.feedback_campaigns c
  where c.term_id = p_term_id
    and c.blocks_admit_card
  order by
    case c.status
      when 'open' then 0
      when 'closed' then 1
      else 2
    end,
    c.created_at desc
  limit 1;
$$;

comment on function app.gating_feedback_campaign(uuid) is
  'The feedback round that gates admit cards for a term: the open one, else the closed one, else the newest draft.';

revoke all on function app.gating_feedback_campaign(uuid) from public, anon;
grant execute on function app.gating_feedback_campaign(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- admit_card_eligibility — same body as 0015, with the campaign choice fixed
-- --------------------------------------------------------------------------
create or replace function public.admit_card_eligibility(
  p_student_id uuid,
  p_exam_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule              public.admit_card_rules%rowtype;
  v_exam              public.exams%rowtype;
  v_blocks            text[] := array[]::text[];
  v_feedback_done     boolean;
  v_outstanding       numeric(10,2);
  v_exam_fee_due      numeric(10,2);
  v_override          boolean;
begin
  select * into v_exam from public.exams where id = p_exam_id;
  if not found then
    return jsonb_build_object('eligible', false, 'blocks', array['exam_not_found']::text[]);
  end if;

  select * into v_rule from public.admit_card_rules where exam_id = p_exam_id;

  -- With no rule configured, nothing is asserted to be satisfied: the card is
  -- blocked rather than silently issued.
  if not found then
    return jsonb_build_object(
      'eligible', false,
      'blocks', array['no_rule_configured']::text[],
      'detail', 'No admit card rule is configured for this exam.'
    );
  end if;

  -- --- Feedback requirement -------------------------------------------------
  if v_rule.require_feedback then
    select fc.completed_at is not null
      into v_feedback_done
    from public.feedback_completions fc
    where fc.student_id = p_student_id
      and fc.campaign_id = coalesce(
            v_rule.feedback_campaign_id,
            app.gating_feedback_campaign(v_exam.term_id)
          );

    if coalesce(v_feedback_done, false) is false then
      v_blocks := v_blocks || 'feedback_incomplete'::text;
    end if;
  end if;

  -- --- Monthly fee requirement ---------------------------------------------
  if v_rule.require_fees_cleared and v_rule.fees_cleared_through_month is not null then
    select coalesce(sum(fc.amount - fc.amount_paid - fc.discount_amount), 0)
      into v_outstanding
    from public.fee_charges fc
    where fc.student_id = p_student_id
      and fc.status in ('pending', 'partial')
      and fc.period_year is not null
      and (fc.period_year, fc.period_month)
          <= (v_rule.fees_cleared_through_year, v_rule.fees_cleared_through_month);

    if v_outstanding > v_rule.allowed_outstanding then
      v_blocks := v_blocks || 'monthly_fees_outstanding'::text;
    end if;
  end if;

  -- --- Exam fee requirement -------------------------------------------------
  if v_rule.require_exam_fee_paid then
    select coalesce(sum(fc.amount - fc.amount_paid - fc.discount_amount), 0)
      into v_exam_fee_due
    from public.fee_charges fc
    where fc.student_id = p_student_id
      and fc.exam_id = p_exam_id
      and fc.status in ('pending', 'partial');

    if v_exam_fee_due > v_rule.allowed_outstanding then
      v_blocks := v_blocks || 'exam_fee_unpaid'::text;
    end if;
  end if;

  -- --- Audited override -----------------------------------------------------
  select exists (
    select 1 from public.admit_card_overrides o
    where o.exam_id = p_exam_id and o.student_id = p_student_id
  ) into v_override;

  return jsonb_build_object(
    'eligible', (array_length(v_blocks, 1) is null)
                or (v_rule.allow_override and v_override),
    'blocks', v_blocks,
    'overridden', v_rule.allow_override and v_override,
    'outstanding_monthly', coalesce(v_outstanding, 0),
    'outstanding_exam_fee', coalesce(v_exam_fee_due, 0)
  );
end;
$$;

comment on function public.admit_card_eligibility(uuid, uuid) is
  'Single definition of admit-card eligibility. With no rule configured, the card is blocked.';

revoke all on function public.admit_card_eligibility(uuid, uuid) from public, anon;
grant execute on function public.admit_card_eligibility(uuid, uuid) to authenticated;

-- --------------------------------------------------------------------------
-- default_admit_card_rule — same fix
-- --------------------------------------------------------------------------
create or replace function public.default_admit_card_rule(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam     public.exams%rowtype;
  v_campaign uuid;
  v_rule     public.admit_card_rules;
  v_anchor   date;
begin
  if not app.is_authority() then
    raise exception 'only the school office may configure admit card rules'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if not found then
    raise exception 'unknown exam' using errcode = 'no_data_found';
  end if;

  -- The owner's choice: fees must be clear through the EXAM'S OWN MONTH. An
  -- exam with no start date falls back to its term's end, so the rule is never
  -- silently left with no cutoff at all (which blocks every card).
  v_anchor := coalesce(
    v_exam.starts_on,
    (select t.ends_on from public.terms t where t.id = v_exam.term_id)
  );

  v_campaign := app.gating_feedback_campaign(v_exam.term_id);

  insert into public.admit_card_rules (
    exam_id, require_feedback, feedback_campaign_id,
    require_fees_cleared, fees_cleared_through_year, fees_cleared_through_month,
    require_exam_fee_paid, allowed_outstanding, allow_override
  )
  values (
    p_exam_id, true, v_campaign,
    true,
    extract(year from v_anchor)::integer,
    extract(month from v_anchor)::smallint,
    true, 0, false
  )
  on conflict (exam_id) do update
    -- Re-running refreshes the pinned round when the rule has none, but never
    -- repoints a rule the office has already set deliberately.
    set feedback_campaign_id = coalesce(
          public.admit_card_rules.feedback_campaign_id, excluded.feedback_campaign_id)
  returning * into v_rule;

  return jsonb_build_object(
    'exam_id', v_rule.exam_id,
    'require_feedback', v_rule.require_feedback,
    'feedback_campaign_id', v_rule.feedback_campaign_id,
    'require_fees_cleared', v_rule.require_fees_cleared,
    'fees_cleared_through_year', v_rule.fees_cleared_through_year,
    'fees_cleared_through_month', v_rule.fees_cleared_through_month,
    'require_exam_fee_paid', v_rule.require_exam_fee_paid,
    'allowed_outstanding', v_rule.allowed_outstanding,
    'allow_override', v_rule.allow_override
  );
end;
$$;

revoke all on function public.default_admit_card_rule(uuid) from public, anon;
grant execute on function public.default_admit_card_rule(uuid) to authenticated;
