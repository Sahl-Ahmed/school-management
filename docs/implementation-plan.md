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

## Phase 4 — Fees and receipts ✅ done

**Delivered**
- Configurable fee types (monthly class fee, coaching, exam, one-off) with
  per-class or school-wide rates per academic year.
- One-click monthly billing for every actively enrolled student at their own
  class rate, limitable to a single class, **safely repeatable**.
- Exam-fee charging attached to an exam rather than a calendar month.
- Payment entry: find the student, tick the charges to settle, record cash,
  bKash, Nagad, Rocket, bank, cheque or other, with a reference field.
- Monthly clearance status for the office and for the student, month by month.
- Printable receipts — one A4 sheet carrying a guardian copy and an office
  copy either side of a cut line.
- Administrator-only payment reversal and charge waiving, both requiring a
  reason and both audited.

**How duplicates are prevented, which is the point of this phase**
- **Duplicate charges:** a partial unique index over student, fee type,
  academic year, period and exam. Re-running a month reports how many students
  were skipped rather than failing, because re-running after admitting a late
  student is normal office work.
- **Duplicate payments:** the payment form generates the payment's uuid when it
  renders. A second click carries the same id, the RPC finds the row already
  exists and returns the ORIGINAL receipt instead of taking the money again.
  A disabled-button guard would not survive a refresh; this does.
- **Duplicate receipts:** `receipts.payment_id` is UNIQUE, so one payment can
  never yield two receipt numbers however many times the route is called.

**Permissions**
- Office staff (`authority_staff`) may bill and record payments.
- Only `authority_admin` may reverse a payment or waive a charge.
- Students see only their own fees. **Teachers see no student's fees at all** —
  they are absent from the visibility check, not merely unlinked in the UI.

**Money is never deleted.** A payment is reversed, which re-opens the charges it
had cleared; the row and its receipt stay, and a reprint of a reversed receipt
is stamped "REVERSED … this payment has been cancelled" so it cannot be used as
proof of payment.

**Verified**
- 42 local tests for fees and receipts (166 in total across the suite).
- Hosted walkthrough: billed October tuition for 5 students, re-ran it and got
  "No new charges. All 5 eligible students were already billed"; recorded a
  ৳1,650 payment against three months with a DOUBLE CLICK and confirmed exactly
  one payment, one receipt and three allocations in the database; downloaded
  and read the receipt PDF; reversed the payment and watched all three charges
  re-open and the cleared figure return to 0%; reprinted the receipt and
  confirmed the reversal stamp; checked the student's own view shows the same
  position with no download offered for the reversed receipt.

**Known limitations**
- Fee types and rates are configured by inserting rows; there is no screen for
  creating a fee type or editing a rate yet. The seed provides four types and
  tuition rates for every class.
- A payment may be recorded with an unallocated balance, which is held as
  credit but has no screen for applying it to a later charge.
- Partial payment of a single charge works, but the amount must be typed; the
  quick-select buttons settle whole charges only.
- No collection report for a date range, and no daily cash-book summary.
- The exam-fee action exists as an RPC with no screen, since exams arrive in
  phase 5.
- `set_charge_status` supports cancelling as well as waiving, but only waiving
  is wired to a button.

## Phase 5 — Exams, marks, results ✅ done

**Delivered**
- Exam configuration at `/authority/exams`: an exam per term, then one row per
  class per subject with its own maximum, pass mark and date. The subject
  picker offers only the subjects a class actually studies that year.
- A five-stage lifecycle — draft, scheduled, marks open, marks closed,
  published — each stage stating in words what it means for teachers and
  students. The exam **schedule** publishes separately from the **results**, so
  students can see dates long before any mark exists.
- Teacher mark entry at `/teacher/marks`, listing only the subjects the teacher
  is assigned to teach, and only while the office has entry open.
- Submission tracking for the office: per class, section and subject, who is
  assigned, how many marks are in out of the roster, and whether the teacher
  has submitted.
- Result generation and publication: totals, subject grades, GPA, overall
  result, class position and the term's attendance, frozen as a snapshot.
- Teacher-created extra class tests at `/teacher/class-tests`, with their own
  marks and a duplicate-guarded "send result" action.
- Student result views at `/student/results`: earned and maximum marks per
  subject, grades, points, GPA, overall result, position and term attendance.
- A grading policy screen at `/authority/grading` for the bands, the subject
  pass percentage, the pass rule and the GPA convention.

**The grading policy is configuration, and the owner confirmed it**
- Standard GPA-5 bands, 33% subject pass mark, and **every subject must be
  passed** to pass the term. A failed term prints GPA 0.00 and the failing
  grade, per Bangladeshi convention.
- None of it is in code. The bands live in `grade_bands`; the pass rule, the
  pass percentage and the GPA convention are columns on `grading_scales`; and
  each exam records the scale it was published under, so changing the policy
  later cannot re-grade a past exam. See decision 1 in
  [decisions-for-owner.md](decisions-for-owner.md) for what is settled and what
  is still open.

**How a draft mark stays private, which is the point of this phase**
- Students hold **no policy at all** on `marks`. There is nothing to leak from,
  however the page is reached: a student reads results from
  `published_results`, which only ever contains published rows.
- A teacher can read and write marks only for a subject they are assigned to
  teach, and only while the exam is `marks_open` (`app.may_enter_marks`).
- Publication writes an **immutable snapshot** of every figure. A mark
  corrected afterwards changes the record but not the sheet a parent already
  received — verified on the hosted project.
- Publishing is **administrator-only** and **refuses while any mark is
  un-entered**. A partial sheet would total wrongly with nothing on it to show
  that, which is worse than making the office chase the outstanding subject.
- A blank is not a zero and not an absence: a teacher must give every student a
  score or tick absent before a subject can be submitted. An absence scores
  zero but prints as "absent".

**Verified**
- 39 local tests for exams (205 in total across the offline suite).
- **23 tests against the hosted project** (`tests/remote-exams.test.ts`) with
  real sign-ins and real JWTs: a teacher cannot create an exam; entry before
  `marks_open` is refused; a teacher cannot mark a subject they do not teach,
  nor a student outside the section, nor above the maximum, nor change
  submitted marks without a reason; a student cannot read draft marks, not even
  their own; publishing is refused while marks are missing, refused for office
  staff who are not administrators, refused for teachers, and refused a second
  time; the published figures match the confirmed policy to the decimal; a
  student reads their own sheet and not a classmate's; a teacher sees results
  only for students they teach; a correction after publication leaves the
  snapshot untouched; an anonymous caller reaches none of it; and a class test
  sends exactly once.
- Hosted browser walkthrough of the whole workflow: created the exam, added two
  subjects, opened entry, entered Bangla marks as one teacher and Mathematics
  as another (each seeing only their own subject), was refused an incomplete
  sheet, recorded an absence, created a class test and sent its result, then
  published as the administrator and read the resulting sheet as the student.

**Known limitations**
- No result-sheet PDF yet. The student's sheet is a screen; printing it is
  phase 6 with the other printables.
- No notification when every submission is in. The office sees the progress
  table; nothing is pushed, because notifications are phase 7.
- Mark entry has no bulk paste or spreadsheet import; marks are typed per
  student.
- The authority can enter marks for any subject through the RPC but has no
  screen for it, so an unassigned subject still needs a teacher assigned.
- `mark_submissions` carries `reopened_at` and `reopen_reason` for reopening a
  submitted subject, but no screen uses them: the office reopens by moving the
  whole exam back to `marks_open`.
- Terms with no attendance window print no attendance figure. Both exam screens
  warn about this before publication rather than leaving it to be discovered on
  a sheet.
- Class tests do not feed term results, by design, and have no PDF.
- Result SMS is a **development simulation**. The send action records what it
  would have sent and marks the test as sent; no provider is connected and no
  message reaches any phone until phase 7.

## Phase 6 — Feedback, cards, printables ✅ done

**Delivered**
- Term-specific feedback rounds at `/authority/feedback`: two or three rating
  questions in English and Bangla, an optional comment, an open/close window,
  and a minimum-lessons threshold.
- Form generation from the assignments that **overlapped the term**, so a
  teacher who changed mid-term and their replacement each get a form — the
  owner's rule — provided each taught at least the minimum.
- Student submission at `/student/feedback`, one form per teacher, with the
  anonymity explained before anything is answered.
- Authority analysis: per-teacher, per-question averages with a small-sample
  flag, the anonymous comments, and a named list of who has finished.
- Admit cards at `/authority/cards` and `/student/documents`, with eligibility
  from the single shared definition and the reasons spelled out as actions.
- Admit card PDFs, **three to an A4 sheet**, each carrying the student's
  details, the subject timetable and a stored seat code.
- Exam routine PDFs, A4, school-wide or per class.
- Result sheet PDFs, one A4 page per student, from the frozen snapshot.
- ID cards at **PVC CR80 size in both orientations**, front and back, with the
  QR on the back; issue, revoke and reissue, and the public page at
  `/card/<token>`.

**The owner's four decisions for this phase, and where they live**
| Decision | Answer | Stored as |
| --- | --- | --- |
| Admit-card fee cutoff | Through the **exam's own month** | `admit_card_rules.fees_cleared_through_year/month`, defaulted from `exams.starts_on` |
| Emergency contact on the ID card | Print the **guardian's number on the front**, the school's on the back | `document_templates.config.front_fields` / `back_fields` |
| Card orientation | **Both**, the office picks the default | Two `document_templates` rows |
| Mid-term teacher change | Review **both**, if each taught enough | Target generation walks assignments by date overlap |

Outstanding tolerance stays at zero and exceptions stay **off** per exam, both
as the brief specifies, and both are columns the office can change.

**Where the guardian's phone number does and does not appear**
It is **printed on the card front**, so whoever finds a lost card can call the
guardian. It is **not rendered on the public `/card/<token>` page**: a finder
holding the card reads the number off the plastic, whereas publishing it on the
page would hand it to anyone who scans the code without ever touching the card.
The snapshot carries the field because the printed card is generated from it;
the page renders a deliberate subset. If the school wants it on the page too,
that is one field added in `src/app/card/[token]/page.tsx`.

**How anonymity is structural, which is the point of this phase**
- `feedback_responses` and `feedback_comments` have **no student column at
  all** — not a hidden one, not an encrypted one. A full database dump cannot
  attribute a rating.
- Only the **date** is stored on a response, never the time, so submission
  order cannot be correlated against `feedback_completions`, which does name
  students.
- There is **no teacher policy** on either table, and none should ever be
  added. `feedback_analysis` additionally guards on `app.is_authority()`, so a
  teacher gets an empty set rather than their own averages.
- The cost, which the UI states plainly: a submitted rating **cannot be changed
  or withdrawn**, because nothing records which answers were whose.

**How a blocked admit card stays blocked**
- `admit_card_eligibility` is the single definition, used by the student
  portal, the office table and the issue action alike.
- `issue_admit_card` re-checks it **inside its own transaction**, so the office
  cannot issue a blocked card from a different screen — the brief's explicit
  requirement — and a stale URL cannot either.
- With **no rule configured the card is blocked**, not silently issued.
- The PDF route checks again and refuses with the reason, because an admit card
  in a stack is a card an invigilator will accept.
- Blocked students are **left out** of a class stack, and the count skipped is
  returned in a header so the office can chase them.
- An exception requires `authority_admin`, a per-exam `allow_override`, and a
  reason; it records which checks were overridden, and the card prints a line
  saying it was issued by exception.

**Verified**
- 70 new local tests (275 in total offline), including PDF geometry measured in
  points and millimetres: three cards per A4, CR80 at 54 × 85.6 mm either way,
  front and back as two pages of identical size.
- **28 tests against the hosted project** (`tests/remote-documents.test.ts`):
  a teacher reads no rating, comment, aggregate or completion list; a student
  reads none either; the office reads all three; the forbidden-key trigger
  refuses a bad snapshot **even for the service role**; an anonymous caller
  gets the public card and nothing else; a revoked card stops resolving and a
  replacement issues cleanly; the office cannot issue a blocked card; office
  staff cannot approve an exception but an administrator can; and all four PDFs
  are built from the project's own rows — with a Bangla school name written in
  for the duration — and measured.
- Browser walkthrough: created and opened a round, generated its forms,
  submitted feedback as a student in Bangla and English, watched the admit-card
  gate release as feedback completed and block on fees, issued an admit card
  and an ID card from the office, fetched every PDF route over real HTTP as
  both a student and the office, and read the public QR page.

**Known limitations**
- No school logo or head teacher's signature image on any printable: decision 3
  is still open, so there is no file to embed. The signature line is printed
  for signing by hand.
- The ID card has no photo unless one was uploaded; the frame prints empty
  rather than failing.
- An admit card lists four subjects and then says how many more there are. A
  class sitting more than four papers needs the exam routine alongside it.
- The seat code is text on the card, not a scannable barcode.
- No bulk ID-card sheet: cards are generated one student at a time, because
  they print on card stock rather than A4.
- Feedback cannot be reopened for one student; the office reopens the whole
  round.
- Comments are not translated or sentiment-scored — they are shown as written.
- The exam-fee charge is still created by an RPC with no screen of its own.

## Phase 7 — Library and SMS  — library done, SMS simulated

**The owner's decision, mid-phase:** the K40 fingerprint terminal has not been
bought and no SMS provider account will be opened yet. Live SMS delivery and the
K40 bridge are therefore **PENDING**, and neither is claimed as complete
anywhere in this project. Everything around them was built and tested so that
connecting a provider later is a credentials change rather than a rewrite.

### Library — done

Built to the **revised card specification** in
[design-system.md](design-system.md) section 3. The original brief's
PDF-first-page thumbnail is cancelled and is not built; `cover_image_path` and
`cover_generated_at` are retained but commented as cancelled, and a test asserts
nothing writes them.

- Authority management at `/authority/library`: add a book, pick its colour,
  publish or unpublish, check link health, and switch between a card view and a
  list.
- A **live card preview** beside the form, so the office sees what a student
  will see, including the computed text colour and a warning when a chosen
  colour had to be nudged to stay readable.
- Student browsing at `/student/library`, defaulting to **their own class** with
  a one-click "show all classes", filtered by subject.
- Teacher browsing at `/teacher/library`, the whole catalogue — material for a
  class above or below is often what you need when preparing.

**The card, exactly as specified**
- A coloured area carrying the **subject** on top and the **audience** below:
  `Biology` over `Class 9-10`, or `Everyone`.
- The **full title outside the colour**, wrapping to at most three lines then
  truncating, with the whole title kept as the accessible name and the tooltip.
- **Contrast is computed, never chosen.** The authority picks a background;
  `readableOn` picks black or white by relative luminance and nudges the
  background when neither can reach WCAG AA on it. A sweep of the colour cube
  finds 216 colours that fail against both black and white; a test asserts every
  one of them ends up readable, and that all twelve curated presets clear AA.
- A **labelled Open control**, not a mystery click target on the whole card,
  opening the Drive link in a new tab with `rel="noopener"`. A link known to be
  broken says **Unavailable** instead of opening a dead tab.

**One deviation from the written spec, and why.** The spec says `class_id`
carries the audience, but its own example is `Class 9-10`, which a single class
cannot express. `class_to_id` was added so the audience is a range: neither set
reads as `Everyone`, one set as `Class 5`, both as `Class 9-10`. The label is
derived from real class rows rather than typed, so it cannot drift from the
classes it names.

### SMS — built and tested in simulation only

**No provider is connected, and nothing in this system can reach a phone.**
Every screen that could be misread says so, and a simulated dispatch settles its
job as **skipped**, never **sent** — so the office's delivery figures can never
describe messages that do not exist.

What exists and is tested:
- **Message templates** as configuration (`notification_templates`), one default
  per type per language, in English and Bangla, editable at
  `/authority/notifications` with a live preview and a live segment count.
- **Rules** already configurable in school settings: whether the daily summary
  runs at all, the grace period after the last lesson, and the earliest hour.
- **The queue** (`notification_jobs`) for the daily attendance summary,
  published results, class test results and account OTP.
- **Duplicate prevention** by a UNIQUE `dedupe_key` — not a check-then-insert,
  which has a gap, but a unique index that refuses the second row outright.
  Re-running a day queues nothing and reports how many it skipped.
- **A dispatcher** that claims work with `for update skip locked`, renders each
  message, counts its billable segments and records the attempt.
- **Delivery reporting**: the queue by type and status, per-message bodies and
  segment counts, and the delivery log with failures, all for the office.

**What it refuses to do**
- Announce a result that is not published — the one thing this module must
  never do.
- Send a summary for a day no teacher submitted attendance for: "present 0/0"
  reads as an absence when the truth is that nothing was recorded.
- Queue for a student with no phone number, which could only ever fail.
- Mark a simulated dispatch as delivered.

**The em dash that was doubling the bill.** The notifications screen showed the
English result template as "2 segments, 96 characters", which is wrong on its
face — GSM-7 fits 160 characters per segment. The cause was one character: an
em dash, which is not in the GSM 03.38 alphabet, and a single character outside
that alphabet forces the **whole message** into UCS-2 where a segment is 70
characters. Every result SMS the school ever sent would have cost twice what it
needed to, for a piece of punctuation nobody would miss. The counter was always
right; nobody was being told *which* character did it. It now names the
offender, states the saving, and migration 0038 fixed the shipped templates.

**Verified**
- 323 offline tests in total, including every curated card colour reaching AA,
  216 known-bad colours being rescued, the dedupe index refusing a re-run, and a
  simulated dispatch never setting `sent_at`.
- 15 tests against the hosted project: a teacher and a student cannot read a
  draft book even by asking for unpublished rows; neither can read a
  notification job, template or delivery log; an anonymous caller reaches none
  of it; a backwards audience range is refused; and announcing an unpublished
  result is refused.
- Browser walkthrough: added and previewed a book, saw all four card cases
  render with correct computed contrast, queued a day's summaries, re-ran it and
  watched the dedupe refuse the duplicate, dispatched in simulation and read the
  rendered bodies and segment counts, then browsed the catalogue as a student on
  desktop and on a phone-width screen.

**Known limitations, beyond the two pending integrations**
- Link checking is manual, one button for the whole catalogue. Nothing checks on
  a schedule.
- A book is added and published but cannot be edited in place; the colour and
  publication state can be changed, the rest needs removing and re-adding.
- No scheduler. The office presses "queue" and "dispatch"; nothing runs on a
  timer, because a timer that fires into a simulation would only create the
  impression of a working system.
- The OTP path still sends directly rather than through the queue, since it is
  interactive and must not wait for a batch.
- No cost in money, only in segments: a rate belongs with a provider account.

## Phase 8 — UI/UX redesign  — done

The owner's instruction was to redesign the whole experience before touching
hardware or live SMS, and to replace the white-and-green direction with a new
one: primary `#790D16`, page `#F5EFE1`, white surfaces, purposeful extra colour
in charts and meters, inspiration from Canva, and a clear left sidebar in all
three portals. The visual direction is recorded in
[design-system.md](design-system.md), which now opens by stating that it
supersedes Phase 2's palette.

**Built**
- A new token system in `globals.css`: cream page, white cards, the maroon
  ramp, five status colours with their tints, a six-colour chart series, and one
  radius and spacing scale. Every pair clears WCAG AA; the measurements are in
  the design system.
- A left sidebar in all three portals, grouped by what the work is, with the
  active page marked by a filled white panel. Below `lg` it becomes a drawer,
  portalled to `<body>` and closed by any navigation.
- Reusable primitives in `src/components/ui.tsx` — `PageHeader`, `Card`,
  `DataTable`, `Status`, `EmptyState`, `FilterChips`, `FieldList`, `Skeleton`
  and the button shapes — and a rewritten `form.tsx` whose fields carry their
  own errors and whose submits report their own pending state.
- 19 inline line icons, replacing nothing (there were none) and used in the
  navigation, the buttons and the stat cards.
- All three dashboards rebuilt on live data with explicit periods, plus a
  "needs your attention" list on the authority dashboard drawn from real rows.
- Every screen moved onto the primitives: 35 pages and the shared components.
- A loading skeleton per portal, since every portal page is `force-dynamic` and
  a navigation always waits on the server.
- Search and a class filter on the student roster, a class filter on fees and
  cards, and subject filters in the library — all as links, so a filtered view
  is shareable and the page stays a Server Component.

**Found and fixed during the audit**
- **A mislabelled statistic.** The authority dashboard's "Classes with a
  routine: 0 of 12" was counting sections with attendance activity this month,
  not sections with a timetable — which is why it read 0 while Class 3 plainly
  had one. It now counts `routine_periods`, and the per-class table says `set`
  or `none` per section. Verified against the data: Class 8 — A really does have
  no periods.
- **A drawer clipped to 56 pixels.** The menu trigger sits in the frosted top
  bar, and a `backdrop-filter` makes its element the containing block for a
  `position: fixed` descendant, so the drawer opened as a sliver with the page
  showing through. It is now portalled to `<body>`.
- **White text that was not white.** `.on-accent` inverted the focus ring but
  never set a text colour; the sign-in panel's body copy came out near-black on
  maroon. The class now carries the colour, which is what its name implies.
- **A zero-value ring drawing a dot.** A zero-length arc with a round cap still
  paints a cap at twelve o'clock, which reads as "a little bit" rather than as
  nothing.
- **"Good day, School."** The dashboards greeted the first word of a full name,
  which turns "School Principal" into "School". They greet the whole name now.
- **A stale "not built yet" notice.** The student portal still said feedback,
  the library and ID cards were coming in later phases, three phases after they
  shipped.

**Verified**
- 329 offline tests, unchanged and passing: this phase changed presentation, not
  rules.
- `tsc`, ESLint and `next build` clean.
- Walked the main tasks in a real browser as all three roles at 1440×960 and at
  375×812: sign-in, the three dashboards, attendance with its roster, mark
  entry, the student roster and its class filter, fees, exams and an exam's
  detail, cards and printables, notifications, the library, results, documents,
  and the mobile drawer. A student's result-sheet PDF still downloads and still
  comes back scoped to that one student.

**Deliberately not done**
- The sign-in page does not show the school's name or logo. Nothing about the
  school is readable before sign-in — `school_settings` is `select ... to
  authenticated`, and the only public route to the name is `get_public_card`,
  which answers for one issued card at a time. Printing it on the sign-in screen
  means widening anonymous read access, which is the owner's decision, not a
  thing to slip into a redesign.

## Phase 9 — K40 bridge  — **PENDING: hardware not purchased**

The owner has not bought the K40 terminal. Nothing in this phase is built, and
the device integration is not claimed anywhere. The database side — devices,
device users, raw punches, shifts and derived daily attendance — exists from
migration 0007 and is untested against hardware.


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

## Phase 10 — Hardening and launch

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
