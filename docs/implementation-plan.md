# Implementation plan

A phase is done when its permissions, persistence, validation, error handling
and end-to-end workflow have been checked — not when its screens render.

## Phase 1 — Foundation ✅ done

Schema, permissions, accounts, portal shell.

**Delivered**
- 19 migrations, 60 tables, 131 RLS policies, 26 authorisation helpers.
- Audit triggers on 40 tables.
- Three storage buckets with object policies.
- Synthetic seed, including the sibling pair sharing a guardian phone.
- Sign-in for all three roles; registration-number login mapped to Auth.
- Role routing and the activation gate.
- Authority dashboard counters, teacher assignment list, student profile and
  fee total — all live queries.
- The public QR card page, working end to end.
- 49 tests, including RLS exercised as `authenticated` with a JWT claim.

**Explicitly not delivered:** everything marked with a phase number in the
portal navigation; those items are greyed out rather than linked.

**Verification run**
```
npm run verify     # typecheck, lint, migrations + seed, 49 tests
npm run build      # production build
```

## Phase 2 — Admission and activation ✅ done

**Delivered**
- Add Student: full brief field set, with browser-side photo compression and
  server-side size validation.
- Add Teacher, including class assignments and the fingerprint device-user-id
  mapping with a distinct-finger count.
- Students list with search by name or registration number, and pagination.
- Teachers list showing assignment count, device mapping and an enrollment
  warning below three distinct fingers.
- Atomic admission RPCs (migration 0022) with auth-account compensation.
- OTP activation and password recovery for both students and teachers:
  hashed codes, expiry, per-challenge attempt limits, per-identifier rate
  limits, and one shared implementation for both flows.
- SMS adapter with `simulate` and `live` modes and correct Bangla segment
  counting.

**Verified**
- 76 local tests, plus 15 Storage and 12 OTP tests against the hosted project.
- Browser walkthrough on the hosted project: admitted a student with a
  compressed photo; activated the account with the simulated code; admitted a
  **sibling on the same guardian phone** with a separate account; a duplicate
  registration number was refused case-insensitively and left no orphan
  account; submitted the teacher form and confirmed the saved teacher,
  assignment and device mapping; activated the teacher, including a rejected
  wrong code; reset the teacher password and confirmed the old one is dead;
  confirmed an un-activated account is confined to `/activate`.
- Photo compression measured in a real browser: a 24 MB 2400x3000 noise PNG
  reduced to 189 KB at 600x750 WebP.

**Still simulated / not done**
- **SMS is a development simulation.** No provider account is connected, so no
  message reaches a phone. Needs owner decision 7 and credentials.
- Student and teacher **profile pages** (opening an individual record) are not
  built; the lists show summary cards only.
- **Editing** a student or teacher after admission is not built.
- **Promotion** between academic years is not built; the schema supports it.
- Changing a student's recovery phone (which the brief says requires authority
  verification and an audit record) is not built.

**Bugs found and fixed during Phase 2 verification**
- `sms_delivery_logs.job_id` was NOT NULL, so no account OTP could ever be
  logged — fatal in simulate mode, where the log is the only place the code
  appears (migration 0023).
- `sendSms` ignored its insert error and reported success regardless; it now
  returns `logged` and the tests assert it.
- `''::date` in both admission RPCs: `coalesce` ran after the cast, so an empty
  `effective_from` raised instead of defaulting to today (migration 0024).

## Phase 3 — Routine and attendance ✅ done

**Delivered**
- Design tokens rebuilt to the white/green/black light palette in
  [design-system.md](design-system.md), and applied across every screen built
  in phases 1 and 2 as well as the new ones. Portal chrome is now shared, with
  a green brand rule and an underlined active section.
- Chart primitives (`src/components/charts.tsx`) that **require** a denominator
  as a prop, so a percentage with an invisible basis cannot be rendered, and
  that say "no data" rather than drawing 0%.
- Routine builder per class/section, with clash prevention surfaced in the UI:
  the message names the conflicting lesson, its teacher and its times.
- Closing a period by effective date rather than deleting it, so past lessons
  keep their original teacher.
- Combined school-wide A4 PDF and per-class A4 PDFs, generated server-side
  with pdf-lib.
- Teacher attendance: lesson picker by date showing submitted vs not
  submitted, roster with per-student status and remark, bulk setter,
  correction flow requiring a reason.
- Student attendance by month and by subject, with a year-to-date figure.
- Teacher timetable and student published routine.
- Authority dashboard: live roster counts, school-wide attendance ring,
  per-class table, and a list of specific lessons awaiting submission.

**Verified**
- 121 local tests, including 34 covering attendance and the routine.
- Browser walkthrough on the hosted project: both clash types refused with the
  conflicting lesson named; a valid period added; both PDFs downloaded and
  confirmed to be exactly 210x297 mm with correct content; a partial roster
  refused; a full submission with one absence recorded; the student view showing
  the right denominator; the dashboard showing "no data" rather than 0%.
- PDFs opened and read, not merely generated.

**The invariant, and how it is enforced**
- `submit_attendance` writes the session and every student row in one
  transaction, setting `submitted_at` LAST. A failure leaves the lesson
  unsubmitted, never half-submitted.
- Every percentage divides by submitted lessons. Unsubmitted lessons are
  derived from the routine and reported separately, in the student's own words
  on their attendance page.
- Holidays, cancellations and non-teaching weekdays are refused as attendance
  dates and excluded from the outstanding count.

**Known limitations**
- Bulk roster entry is one lesson at a time; there is no "mark the whole day".
- Cancelling a period and declaring a holiday have database support and are
  honoured everywhere, but no authority screen yet.
- Attendance history older than the current month is reachable only by
  stepping back a month at a time.

**Bugs found and fixed during Phase 3 verification**
- Migration 0020 had revoked `EXECUTE` on the custom `timerange` constructor
  from `authenticated`. A routine exclusion constraint evaluates it as the
  WRITING user, so every attempt to add a routine period failed with
  "permission denied for function timerange" — on the hosted project too. Fixed
  in 0026; it went unnoticed earlier because the only constraints exercised
  then used the built-in `daterange`.
- `app.owns_student_record` returned NULL rather than false for a non-student.
  NULL propagated through the visibility `or`, and `if not NULL` does not take
  its branch, so **any teacher could read any student's attendance**. Fixed in
  0027, with the guard additionally wrapped in `coalesce(..., false)` so a
  future NULL denies instead of permitting.
- `unsubmitted_scheduled` counted `teaching_sessions` with no submission, but
  such lessons have no row at all, so the figure was structurally always zero
  and the student-facing notice could never appear. Fixed in 0028 by deriving
  it from the routine.
- The attendance roster submitted per-radio form fields. React 19 resets a form
  after a Server Action, so a rejected submission cleared every radio while the
  counter still showed them marked, and a retry submitted nothing. The roster
  now serialises its own state into one field.
- `formData.get()` returns `null` for an absent optional field and Zod's
  `.optional()` rejects `null`, so every first submission failed its parse and
  blamed the lesson and the marks, which were both fine.
- `fit()` and `drawHeader()` in the PDF generator sanitised text but discarded
  the dropped-glyph count, so the Bangla warning read zero in exactly the cells
  that carry subject and teacher names.
- `latin()` rejected em dashes as non-encodable although CP1252 encodes them,
  so the PDF's own title printed "Class Routine ? Class 3".

**Bangla in PDFs — resolved after Phase 3's merge**
- Noto Sans Bengali (Regular and Bold) is embedded from `src/lib/pdf/fonts`,
  replacing the WinAnsi standard fonts that could not represent Bengali at all.
- The blocker was not the font but the shaper: `@pdf-lib/fontkit` ships a
  transpiled bundle whose Indic shaper is a generator function expecting a
  `regeneratorRuntime` global it does not include, so measuring one Bengali
  character threw. Latin never reached that path, which is why it stayed
  hidden. A `regenerator-runtime/runtime.js` import fixes it. Upstream
  `fontkit` needs no polyfill but its v2 subsetter is incompatible with
  pdf-lib, which would embed the whole 141 KB face per document.
- Shaping is genuinely applied, not codepoint mapping: the conjunct `ক্ষ`
  measures narrower than the unligated `কষ`, which a test asserts. Verified
  visually too — pre-base vowels reorder correctly (`শিক্ষক`) and conjuncts form
  (`বিজ্ঞান`, `শ্রেণি`).
- `fit()` truncates by code point rather than UTF-16 unit, so shortening a long
  title cannot cut a conjunct in half.
- `next.config.ts` lists the font directory in `outputFileTracingIncludes`,
  without which the build would succeed and the first production request would
  fail with ENOENT.

## Phase 4 — Fees and receipts

**Build**
- Fee type and rate configuration; bulk monthly charge generation.
- Payment posting with allocation across charges.
- Printable cash receipt with a sequential number.
- Student fee views.

**Done when**
- Generating monthly charges twice does not double-bill.
- A receipt cannot be issued twice for one payment.
- A reversal reopens the charges it had cleared.
- The student portal and the office screen agree on what is outstanding.

## Phase 5 — Exams, marks, results

**Build**
- Exam configuration: subjects, maximum marks, dates, grading scale.
- Teacher mark entry for assigned subjects only; submission tracking.
- Authority view of pending submissions, plus a notification when all are in.
- Result generation and publication, with the attendance window applied.
- Extra class tests and the controlled "Send Result to Parents" action.

**Done when**
- Draft marks are invisible to students before publication.
- A mark above the maximum is refused.
- Publication writes an immutable snapshot.
- Clicking "Send Result" twice sends one round of SMS.

**Needs:** decision 1 (grade scale).

## Phase 6 — Feedback, cards, printables

**Build**
- Feedback campaigns, target generation from assignments, student submission.
- Authority analysis with the small-sample flag.
- Admit-card eligibility surfaced in the portal and the office search.
- Admit cards (3 per A4), seat tokens, ID cards (PVC, front/back), class PDFs.
- QR token issue, revoke and reissue.
- A4 routine PDFs, school-wide and per class.

**Done when**
- A teacher cannot see who said what, at any aggregation.
- Incomplete feedback or unmet fee rules blocks admit-card issue on every
  screen, including the office's.
- A public QR page shows only printed card fields.
- A revoked token stops resolving and a replacement issues cleanly.
- A4 and PVC PDFs measure correctly when printed, not just on screen.

**Needs:** decisions 2, 3, 4, 5, 6.

## Phase 7 — Library and SMS

**Build**
- Library CRUD and publish/unpublish, with book cards built to the REVISED
  specification in [design-system.md](design-system.md#3-library-book-cards--revised-specification):
  a coloured area showing subject on top and audience below, the full title
  elsewhere on the card, an authority-chosen background colour with text
  contrast computed from it, and a clear Open action for the PDF link.
  **Cover generation from the PDF first page is cancelled — do not build it.**
- `sms.bd` adapter behind the provider interface.
- Daily attendance summary job: eligibility, body composition, segment
  counting, dispatch, delivery-status reconciliation.
- Authority views of pending, sent and failed messages.

**Done when**
- A long book title wraps to at most three lines and the card grid stays even.
- Every authority-chosen card colour yields readable text automatically.
- Exactly one daily job exists per student per school day.
- No summary sends while a scheduled, non-cancelled period is unsubmitted.
- Holidays and fully cancelled days produce no job.
- Bangla segment counts are correct (70 characters, not 160).
- Simulate and live modes are distinguishable in the logs.

**Needs:** decision 7 and real provider credentials. Until the account is
confirmed, SMS stays simulated and must be reported as such.

## Phase 8 — K40 bridge

**Build**
- On-site sync service: autostart, device auth, incremental fetch, dedupe,
  offline queue, secure upload.
- Ingest endpoint authenticated by a shared secret.
- Derivation of daily summaries from raw punches with shift, holiday and leave
  rules.
- Sync health and unmapped-user warnings in the authority portal.
- A documented USB/manual import fallback.

**Done when**
- Tested against the physical terminal. Not before.
- A replayed backlog does not inflate attendance.
- Clock drift, a missing OUT punch and repeated punches are handled.
- The terminal's port is not exposed to the public internet.

**Needs:** decision 8 and physical access to the device.

## Phase 9 — Hardening and launch

- Role and security review against the full policy set.
- Print checks on real paper and real PVC stock.
- Offline-sync, backup and restore drill.
- Load check on the dashboard aggregates with realistic volumes.
- Acceptance testing with actual school staff.
- Production deploy, backup schedule, restore runbook.

## Status reporting

Each phase closes with a plain statement of: what works, what is simulated,
what needs credentials or hardware, and the exact tests performed. A screen
existing is never reported as a working feature.
