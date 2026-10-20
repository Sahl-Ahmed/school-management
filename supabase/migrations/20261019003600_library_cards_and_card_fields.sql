-- ===========================================================================
-- 0036  Library card colours, audience ranges, and the QR visibility rule
-- ---------------------------------------------------------------------------
-- Two owner decisions land here.
--
-- 1. THE PUBLIC CARD SHOWS WHAT THE CARD PRINTS.
--
-- Phase 6 left these out of step. The snapshot carried `guardian_phone` and the
-- printed card showed it, but the public page rendered a different key and so
-- silently dropped it; migrations 0033 and 0034 then described that omission as
-- deliberate. The owner has now settled the rule outright: the public page
-- shows the same student details the card prints, and a contact number printed
-- on the card is therefore readable by anyone who scans the code.
--
-- Nothing executable changes for that — the snapshot already carried the field,
-- and `src/lib/school/card-fields.ts` is now the single list the page and the
-- template both draw from, with a test that a printed field cannot be missing
-- from the page. What changes is the function's COMMENT, which currently tells
-- the next reader of `\df+` the opposite of the truth.
--
-- The bound on what may be in a snapshot at all is unchanged and is not a
-- matter of template configuration: the trigger from 0011 still refuses parent
-- names, NIDs, birth certificate numbers, fees, marks and attendance.
--
-- 2. LIBRARY CARDS, per the revised specification in docs/design-system.md.
--
-- The cancelled thumbnail design is formally retired here, and the card gains
-- the colour the authority picks. The audience line also gains a RANGE: the
-- specification's own example is "Class 9-10", which a single class_id cannot
-- express, so `class_id` becomes the start of a range and `class_to_id` its
-- end. Both NULL still means "Everyone", and one set alone still means a single
-- class. The label is derived from real class rows rather than typed as free
-- text, so it cannot drift from the classes it names.
--
-- Text colour is NOT stored. It is computed from the background by relative
-- luminance at render time, which is what makes an unreadable combination
-- impossible rather than merely discouraged.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The corrected comment
-- --------------------------------------------------------------------------
comment on function public.issue_qr_token(uuid, text, uuid, text) is
  'Issues a public card link. The snapshot carries the template''s declared fields and issuing revokes the previous card. The public /card/<token> page shows the same student details the card prints, including a printed contact number, by the owner''s decision; the snapshot trigger still refuses parent names, NIDs, fees, marks and attendance.';

comment on column public.qr_tokens.card_snapshot is
  'Frozen printed-card fields, and the whole public surface: the public page shows these same details. Never parent names, NIDs, fees, marks or attendance.';

-- --------------------------------------------------------------------------
-- 2. Library book cards
-- --------------------------------------------------------------------------
alter table public.library_books
  -- The background the authority picks. Validated as a 6-digit hex colour so a
  -- malformed value cannot reach the style attribute of a rendered card.
  add column if not exists card_color text
    check (card_color is null or card_color ~* '^#[0-9a-f]{6}$'),
  -- The end of the audience range. NULL with class_id set means a single class.
  add column if not exists class_to_id uuid
    references public.classes (id) on delete set null,
  -- The short subject or topic for the coloured area's top line. `category`
  -- already carried this, and still does; this is its explicit name so a
  -- future category taxonomy does not have to double as display text.
  add column if not exists subject_label text;

comment on column public.library_books.card_color is
  'Card background chosen by the authority. Text colour is computed from it, never stored.';
comment on column public.library_books.class_to_id is
  'End of the audience range. With class_id alone the card reads "Class 5"; with both, "Class 9-10"; with neither, "Everyone".';
comment on column public.library_books.subject_label is
  'The coloured area''s top line: a short subject or topic such as Biology or ICT.';

-- The range must run upwards, so "Class 10-9" cannot be stored.
create or replace function app.enforce_library_audience_range()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from integer;
  v_to   integer;
begin
  if new.class_to_id is null then
    return new;
  end if;

  if new.class_id is null then
    raise exception 'an audience range needs a starting class, not only an ending one'
      using errcode = 'check_violation';
  end if;

  select level_order into v_from from public.classes where id = new.class_id;
  select level_order into v_to   from public.classes where id = new.class_to_id;

  if v_to < v_from then
    raise exception 'the audience range runs backwards: the ending class is below the starting one'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger library_books_audience_range
  before insert or update of class_id, class_to_id on public.library_books
  for each row execute function app.enforce_library_audience_range();

-- --------------------------------------------------------------------------
-- The cancelled thumbnail design, formally retired
-- --------------------------------------------------------------------------
-- The columns are kept rather than dropped: dropping them would rewrite a
-- table for no gain, and a comment that says "do not use this" is harder to
-- ignore than a column that is simply absent from one query.
-- --------------------------------------------------------------------------
comment on column public.library_books.cover_image_path is
  'CANCELLED. The PDF-first-page thumbnail design was replaced by the coloured card in docs/design-system.md section 3. Nothing writes or reads this.';
comment on column public.library_books.cover_generated_at is
  'CANCELLED, with cover_image_path. Nothing writes or reads this.';

-- ===========================================================================
-- library_catalogue — what a reader sees, with the audience label resolved
-- ---------------------------------------------------------------------------
-- The audience label is built here rather than in the application because
-- three callers need the same words — the authority list, the student grid and
-- the teacher grid — and a label assembled three times is a label that will
-- eventually read three ways.
-- ===========================================================================
create or replace function public.library_catalogue(
  p_include_unpublished boolean default false
)
returns table (
  id              uuid,
  title           text,
  title_bn        text,
  author          text,
  subject_label   text,
  category        text,
  description     text,
  audience_label  text,
  class_id        uuid,
  class_to_id     uuid,
  card_color      text,
  drive_url       text,
  link_ok         boolean,
  link_checked_at timestamptz,
  is_published    boolean,
  created_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.id, b.title, b.title_bn, b.author,
    -- subject_label is the explicit column; category is what earlier rows used.
    coalesce(nullif(btrim(coalesce(b.subject_label, '')), ''), b.category) as subject_label,
    b.category,
    b.description,
    case
      when b.class_id is null then 'Everyone'
      when b.class_to_id is null then cf.name
      when cf.id = ct.id then cf.name
      -- "Class 9" + "Class 10" reads better as "Class 9-10" than as the two
      -- names joined, so a shared "Class " prefix is collapsed.
      when cf.name like 'Class %' and ct.name like 'Class %'
        then 'Class ' || substring(cf.name from 7) || '-' || substring(ct.name from 7)
      else cf.name || ' - ' || ct.name
    end as audience_label,
    b.class_id, b.class_to_id, b.card_color,
    b.drive_url, b.link_ok, b.link_checked_at, b.is_published, b.created_at
  from public.library_books b
  left join public.classes cf on cf.id = b.class_id
  left join public.classes ct on ct.id = b.class_to_id
  where (
      b.is_published
      -- Only the office may ask for the unpublished ones, and only when it
      -- does ask: a published-only list is the default for every caller.
      or (p_include_unpublished and app.is_authority())
    )
    and coalesce(app.is_authority() or app.is_teacher() or app.is_student(), false)
  order by
    b.is_published desc,
    coalesce(cf.level_order, 0),
    coalesce(nullif(btrim(coalesce(b.subject_label, '')), ''), b.category, ''),
    lower(b.title);
$$;

comment on function public.library_catalogue(boolean) is
  'The library as a reader sees it. Resolves the audience label; unpublished rows only for the office.';

revoke all on function public.library_catalogue(boolean) from public, anon;
grant execute on function public.library_catalogue(boolean) to authenticated;

revoke all on function app.enforce_library_audience_range() from public, anon;
