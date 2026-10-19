# Design system

Owner-specified visual direction, recorded in Phase 2 and binding from Phase 3
onward. These are requirements, not suggestions: screens built before this was
written (the login page, the three portal shells, the admission forms) are to be
brought into line as their phases are revisited.

## 1. Palette and character

**White, green and black are the primary colours.** The product is a **light**
interface — not a dark theme with a light option, and not a neutral grey
dashboard.

| Role | Use |
| --- | --- |
| White | Page and card backgrounds, the dominant surface |
| Green | Primary actions, active states, accents, positive indicators |
| Black (near-black) | Body text, headings, strong borders, high-contrast detail |

Greys exist only as supporting tones — hairline borders, muted secondary text,
subtle fills. They are not a third brand colour.

### Avoid the generic AI look

This is an explicit requirement from the owner, so it is worth naming what to
avoid rather than leaving it to taste:

- **No purple/indigo-to-pink gradient anything.** No gradient buttons, no
  gradient headers, no gradient text.
- **No glassmorphism** — no frosted translucent cards floating over a blurred
  colourful blob.
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

### Consistency across portals

The Authority, Teacher and Student portals share one visual language: the same
header, the same card and table styling, the same control shapes, the same
spacing scale. A student should recognise the product their teacher uses.

Role is distinguished by **content and navigation only** — never by a different
colour scheme per portal.

## 2. Data visualisation

Charts, circular meters and percentage indicators appear throughout: attendance
percentages, grade distribution, male/female splits, fee clearance, mark
submission progress.

- Use **tasteful, readable colour** — greens for the positive end of a scale,
  warm tones for attention, near-black for neutral reference. Not a rainbow.
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
- Offer a curated set of defaults that fit the white/green/black palette, with a
  free colour picker behind it for the authority that wants one.

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

Changes required when the Library phase is built:

- **Add** a background colour column (for example `card_color`), validated as a
  hex colour.
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

## 5. Where this is implemented

- Tokens live in `src/app/globals.css` under `@theme` and `:root`.
- Implemented in Phase 3. `globals.css` now carries the white/green/black
  palette, a single green hue ramp around 152 degrees, and a light-only
  `color-scheme` with no dark overrides — this is a light interface by
  specification, not a dark theme with a light option.
- Chart primitives live in `src/components/charts.tsx`. `RingMeter`, `BarSeries`
  and `StatCard` all **require** their denominator as a prop, so a figure with
  an invisible basis cannot be rendered, and they say "no data" instead of
  drawing 0%.
- Shared controls are in `src/components/form.tsx` and
  `src/components/portal-shell.tsx`. New screens use these rather than
  restyling inputs locally.
