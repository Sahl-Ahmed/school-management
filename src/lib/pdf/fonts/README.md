# Embedded PDF fonts

**Noto Sans Bengali** — Regular (400) and Bold (700), vendored as TrueType.

## Why these files are committed

The routine PDFs must print Bangla school, subject and teacher names. pdf-lib's
built-in `StandardFonts` are WinAnsi-encoded and cannot represent Bengali at
all; before these were embedded, Bangla printed as `?`.

The files are committed rather than installed from npm because:

- The only npm packages shipping a Bengali TTF are React Native oriented
  (`@expo-google-fonts/*`); `@fontsource/*` ships only woff/woff2, which pdf-lib
  cannot embed.
- A PDF generator should not depend on a file resolving inside `node_modules` at
  request time. `next.config.ts` lists this directory in
  `outputFileTracingIncludes` so the deployment carries it.

## Licence

SIL Open Font License 1.1 — see [OFL.txt](OFL.txt). The OFL permits bundling and
redistribution with software, including commercially, provided the licence
travels with the fonts and they are not sold on their own.

Source: <https://fonts.google.com/noto/specimen/Noto+Sans+Bengali>

## Shaping

Bengali needs real shaping, not codepoint-to-glyph mapping: `ি` is typed after
its consonant but renders before it, and clusters like `ক্ষ` form conjunct
ligatures. pdf-lib delegates layout to fontkit, whose Indic shaper handles both
— see `src/lib/pdf/routine.ts` for the `regenerator-runtime` import that the
bundled fontkit needs before that code path will run.
