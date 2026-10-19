-- ===========================================================================
-- 0012  Shared library of class materials
-- ---------------------------------------------------------------------------
-- The authority records a Google Drive link that the school has deliberately
-- made shareable. Cover images are generated from the PDF's first page and
-- stored in Supabase Storage rather than hot-linked from Drive, because Drive
-- thumbnail URLs are short-lived and break silently.
-- ===========================================================================

create table public.library_books (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(btrim(title)) > 0),
  title_bn          text,
  author            text,
  category          text,
  description       text,

  -- NULL class_id means the book is offered to every class.
  class_id          uuid references public.classes (id) on delete set null,

  -- The intentionally shareable Drive link.
  drive_url         text not null check (drive_url ~* '^https://'),
  -- Cover rendered from the PDF's first page and cached in Storage.
  cover_image_path  text,
  cover_generated_at timestamptz,

  -- Set when a link check fails, so broken material can be found and replaced
  -- rather than silently sitting in the catalogue.
  link_checked_at   timestamptz,
  link_ok           boolean,

  is_published      boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles (id) on delete set null
);

create index library_books_published_idx
  on public.library_books (is_published, class_id);

create index library_books_title_idx on public.library_books (lower(title));

create trigger library_books_touch_updated_at
  before update on public.library_books
  for each row execute function app.touch_updated_at();

comment on column public.library_books.cover_image_path is
  'Cached cover from the PDF first page. Drive thumbnail links expire, so they are not used.';
comment on column public.library_books.class_id is
  'NULL means available to all classes. Students may still filter by any class.';
