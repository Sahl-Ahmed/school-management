# Design system

Owner-specified visual direction. **Phase 8 replaced the palette**: the
white-and-green scheme recorded in Phase 2 is superseded by the maroon-and-cream
one below, and every screen was moved onto it in that phase. Everything else in
this document — the honesty rules for charts, the library card specification,
the typography rules — carried over unchanged, because none of it was about
which colours were used.

These are requirements, not suggestions.

## 1. Palette and character

The product is a **light** interface — not a dark theme with a light option, and
not a neutral grey dashboard.

| Role | Token | Value |
| --- | --- | --- |
| The page | `--surface` | `#F5EFE1`, a warm cream |
| A card | `--surface-raised` | `#FFFFFF` |
| A sunken strip inside a card | `--surface-sunken` | `#FAF6EC` |
| Primary button, hover, active | `--accent`, `--accent-hover`, `--accent-active` | `#790D16`, `#5E0D14`, `#3A0509` |
| Body text | `--text-primary` | `#1A1412` |
| Secondary text | `--text-secondary` | `#4A403C` |
| Muted text | `--text-muted` | `#6B5F59` |

The structural rule the whole interface follows: **white cards floating on
cream, maroon confined to the sidebar and to the controls you press.** Painting
the maroon across the header as well stopped it feeling like a workspace and
started it feeling like a brochure, which is why the top bar is cream.

### The brand colour is a dark red, so danger is separated by FORM

A maroon primary button and a red destructive button cannot be told apart by
hue, so they are told apart by shape:

| Meaning | Rendering |
| --- | --- |
| Primary action | Solid maroon fill, white text |
| Destructive action | **Outlined** in `--state-bad`, never a solid red slab |
| Error message | A tinted panel with an icon, never colour alone |

This is enforced by `SubmitButton`'s `tone` in `src/components/form.tsx` rather
than left to each screen.

### Measured contrast

Every foreground/background pair in the palette clears WCAG AA, and most clear
AAA. Measured with the same formula as `src/lib/school/contrast.ts`:

| Pair | Ratio |
| --- | --- |
| Body text on cream / on white | 15.9 / 18.2 |
| Secondary text on cream / on white | 8.8 / 10.1 |
| Muted text on cream / on white | 5.4 / 6.2 |
| White on the primary button (default / hover / active) | 11.2 / 13.6 / 17.4 |
| Maroon text on white / on cream | 11.2 / 9.7 |
| Each status colour on its own tint | 4.8 – 9.1 |
| Each chart colour under white text | 5.3 – 6.5 |

The lowest figure in the whole palette is **4.76**, for the steel blue used by
the `info` tone on its tint. Nothing in the product relies on a pair below AA.

### Avoid the generic AI look

This is an explicit requirement from the owner, so it is worth naming what to
avoid rather than leaving it to taste:

- **No purple/indigo-to-pink gradient anything.** No gradient buttons, no
  gradient headers, no gradient text.
- **No glassmorphism** — no frosted translucent cards floating over a blurred
  colourful blob. (The sticky top bar and the sticky submit bars do blur what
  scrolls under them. That is one hairline-separated strip reading as glass over
  the page beneath it, not a floating card, and it is the only use of blur in
  the product.)
- **No emoji as interface iconography.** Icons are drawn, consistent, and
  monochrome unless carrying meaning.
- **No oversized hero sections** with a centred headline and two buttons on an
  administrative screen. This is a tool school staff use daily, not a landing
  page.
- **No drop shadows stacked for depth.** One restrained shadow level, or a
  hairline border, not both.
- **No rounded-everything.** A consistent, modest radius; tables and dense data
  stay square enough to read.

Aim instead for something that looks **deliberately designed for this school**:
confident typography, generous spacing where it aids reading, tight spacing
where density helps, and colour used to mean something rather than to decorate.

Phase 8's own reference point was Canva: **neat, spacious, obvious**. What that
meant in practice was a left sidebar that never moves, one card shape, one
control shape, generous spacing between sections and tight spacing inside dense
data, and an interface that says in words what it is showing.

### Consistency across portals

The Authority, Teacher and Student portals share one visual language: the same
sidebar, the same top bar, the same card and table styling, the same control
shapes, the same spacing scale. A student should recognise the product their
teacher uses.

Role is distinguished by **content and navigation only** — never by a different
colour scheme per portal.

## 1a. Navigation and layout

Every portal has a **left sidebar**, maroon, fixed, with the active page marked
by a filled white panel and `aria-current`. In a vertical list an underline is
nearly invisible, and "which page am I on" is the question a sidebar exists to
answer, so it gets the loudest signal available.

Items are **grouped by what the work is**, not by the order the phases were
built in:

| Portal | Groups |
| --- | --- |
| Authority | Dashboard · People · Day to day · Exams · Communication |
| Teacher | Today · Teaching · Reference · Me |
| Student | My profile · My work · My school |

A navigation item with no `href` is **not built yet**: it renders dimmed with a
note rather than linking to a page that 404s.

Below `lg` the sidebar becomes a drawer opened from the top bar. Two details it
depends on, both of which were bugs first:

- The drawer is **portalled to `<body>`**. The trigger sits in the frosted top
  bar, and a `backdrop-filter` makes its element the containing block for any
  `position: fixed` descendant — so a drawer rendered in place opened as a
  56-pixel sliver.
- It is open **only for the route it was opened on**, which closes it on any
  navigation (including the back button) without an effect that sets state
  after the fact.

## 2. Data visualisation

Charts, circular meters and percentage indicators appear throughout: attendance
percentages, grade distribution, male/female splits, fee clearance, mark
submission progress.

- Use **tasteful, readable colour** — green for the positive end of a scale,
  amber for attention, red for a real problem, steel blue for "adequate", slate
  for a neutral reference. Not a rainbow.
- **The brand colour is not a score.** The 75–89% band is steel blue, not
  maroon: maroon means "the button you press", and reusing it for a middling
  attendance figure teaches a reader that the brand colour means "adequate",
  which then makes every primary button look lukewarm.
- A chart whose categories carry no good/bad meaning (students per class) uses
  the six-colour `SERIES` palette instead of the status tones, so nobody has to
  learn that purple means "late".
- Every chart shows its **denominator and period**. A bare "87%" is not
  acceptable; the brief is explicit that invented or context-free statistics are
  not to be displayed.
- Circular meters state the figure numerically in the centre as well as
  visually, because a ring alone cannot be read precisely.
- Colour is never the only carrier of meaning: pair it with a label, a value or
  a pattern so the chart survives colour-blindness and a black-and-white print.
- Charts must remain legible when printed on A4 in greyscale, since result
  sheets and class reports are printed.

## 3. Library book cards — REVISED SPECIFICATION

**This supersedes the thumbnail requirement in the original brief (section 9)
and in [data-model.md](data-model.md).** The earlier design — generating or
caching a cover image from the PDF's first page — is **cancelled and must not be
built.**

### What a card shows

Each book card carries a **coloured area** containing two pieces of text:

```
┌─────────────────────────────┐
│                             │
│         Biology             │  ← subject / short topic, on top, prominent
│        Class 9–10           │  ← audience, below, smaller
│                             │
├─────────────────────────────┤
│ Essentials of Human Biology │  ← full title, outside the coloured area
│ and Physiology, Volume II   │
│                        Open │
└─────────────────────────────┘
```

- **Top line — subject or short topic.** For example `Biology`, `Mathematics`,
  `ICT`. Short, set large, the thing the eye lands on.
- **Bottom line — audience.** For example `Class 9–10`, `Class 5`, or
  `Everyone` for material offered to every class.
- **Full title — elsewhere on the card**, outside the coloured area.

### Long titles

A long title must degrade sensibly, not break the grid:

- Wrap to at most **three lines**, then truncate with an ellipsis.
- The full title remains available as the element's accessible name and tooltip,
  so nothing is lost.
- Card height stays uniform across a row so the grid does not become ragged.
- The subject and audience text never shrinks to accommodate a long title —
  the title yields, not the labels.

### Author-chosen background colour

The authority picks each card's background colour.

- **Contrast is computed, not chosen.** Text colour is derived from the chosen
  background: **dark text on a light background, white text on a dark
  background.** The authority picks the colour; the system picks the text so an
  unreadable combination is impossible.
- Use relative luminance to decide, and hold the result to at least WCAG AA
  (4.5:1) for the title text. If a chosen colour cannot reach AA with either
  black or white, adjust the shade and say so rather than shipping grey-on-grey.
- Offer a curated set of defaults, with a free colour picker behind it for the
  authority that wants one. (The presets predate Phase 8's palette and were left
  alone: a book's colour is the school's choice of subject coding, not part of
  the product's own identity.)

### The Open action

The **Open** action opens the book's PDF link clearly and unmistakably:

- A visible, labelled control — not the whole card as a mystery click target.
- Opens the Google Drive PDF link in a new tab, with `rel="noopener"`.
- States plainly when a link is known to be broken (`library_books.link_ok` is
  false) rather than opening a dead tab.

### Schema consequences

Already present in `library_books` and still correct:

- `category` — carries the subject/short topic for the top line.
- `class_id` — carries the audience; NULL renders as `Everyone`.
- `title`, `title_bn` — the full title.
- `drive_url`, `link_ok`, `link_checked_at` — the Open action and its health.

**BUILT in phase 7.** What was added:

- `card_color`, validated as a 6-digit hex colour, so a malformed value cannot
  reach a rendered card's style attribute.
- `subject_label`, the coloured area's top line. `category` still carries the
  same value, so older rows sort and filter identically.
- `class_to_id`, **a deviation from this document**, because the example above
  is `Class 9-10` and a single `class_id` cannot express a range. Neither set
  reads as `Everyone`, one set as `Class 5`, both as `Class 9-10`; a trigger
  refuses a range that runs backwards, and the label is derived from real class
  rows by `library_catalogue()` rather than typed as free text.

Text colour is **not** stored. `readableOn` in `src/lib/school/contrast.ts`
computes it from the background at render time, which is what makes an
unreadable combination impossible rather than merely discouraged. A sweep of the
colour cube finds 216 colours that clear AA against neither black nor white;
tests assert every one of them is rescued by shading, and that all twelve
curated presets clear AA as chosen.

The cancelled columns:

- **Stop using** `cover_image_path` and `cover_generated_at`. They are retained
  for now so no migration is needed before the Library phase, but nothing should
  write to them, and the Library phase should drop them.

## 4. Typography and language

- Bangla and English sit side by side, so the font stack lists a Bangla face
  ahead of the Latin fallbacks. Latin glyphs fall through correctly; the reverse
  leaves Bangla in a default face with wrong metrics.
- Numbers in tables, marks, amounts and roll columns use tabular figures (the
  `.numeric` class) so columns align.
- Default locale is English with the text layer structured for Bangla, per the
  owner's Phase 1 decision.

## 5. Writing rules

These came out of Phase 8's audit and are now enforced by the primitives, which
is cheaper than remembering them:

- **A figure states its period.** `PageHeader` takes `meta`, and most screens
  put the month or academic year there. "45 lessons awaiting attendance" without
  "in October 2026" is a figure nobody can act on.
- **A statistic's label says what was actually counted.** The audit found a
  dashboard card reading "Classes with a routine: 0 of 12" that was in fact
  counting sections with attendance activity this month — the label and the
  measure disagreed, while Class 3 plainly had a timetable.
- **An empty state says what is missing, why, and what next.** "No data" is not
  an empty state, it is an apology. A teacher looking at an empty mark sheet
  needs to know whether they are early, in the wrong place, or waiting on the
  office.
- **A validation message says what to do.** "Invalid" tells a clerk nothing.
- **A form in flight says so.** Every submit reads its own form's pending state,
  disables, and changes its label, so a slow connection cannot produce a second
  submission or a frozen-looking page.
- **A status carries words, never colour alone**, and a table carries a caption.

## 6. Where this is implemented

- Tokens live in `src/app/globals.css` under `@theme` and `:root`: the
  maroon/cream palette, the status and chart colours, the radius and spacing
  scale, and a light-only `color-scheme` with no dark overrides — this is a
  light interface by specification, not a dark theme with a light option.
- Layout primitives are in `src/components/ui.tsx`: `Card`, `CardHeader`,
  `PageHeader`, `PageSections`, `DataTable`/`Th`/`Tr`/`Td`, `Status`,
  `EmptyState`, `FilterChips`, `FieldList`, `Skeleton`, and the button shapes.
  `DataTable` requires a caption and `StatCard` requires a `detail`, because a
  required prop is cheaper than a convention.
- Navigation is `src/components/portal-sidebar.tsx` (desktop column and mobile
  drawer, sharing one nav renderer so they cannot drift) wrapped by
  `src/components/portal-shell.tsx`. The per-portal item lists are in
  `src/app/{authority,teacher,student}/nav.ts`.
- Icons are 19 inline SVG line icons in `src/components/icon.tsx`, 24×24 on a
  1.75 stroke, all `aria-hidden`. No icon font, no emoji.
- Chart primitives live in `src/components/charts.tsx`. `RingMeter`, `BarSeries`
  and `StatCard` all **require** their denominator as a prop, so a figure with
  an invisible basis cannot be rendered, and they say "no data" instead of
  drawing 0%.
- Shared controls are in `src/components/form.tsx`. New screens use these rather
  than restyling inputs locally.
- Loading states are `src/components/portal-loading.tsx`, rendered by a
  `loading.tsx` in each portal. Every portal page is `force-dynamic`, so a
  navigation always waits on the server; the skeleton draws the sidebar too,
  since the navigation does not depend on the data and making it vanish for the
  duration of a fetch is a worse flash than the one it replaces.
