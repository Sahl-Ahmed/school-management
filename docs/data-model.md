# Data model

60 tables across 19 migrations. This document covers the shape and the
decisions worth questioning; the migrations themselves carry per-column
comments.

## Migration order

| File | Contents |
| --- | --- |
| `0001_extensions_and_enums` | `btree_gist`, `pgcrypto`, the `app` schema, a custom `timerange` type, 16 enums |
| `0002_profiles_and_utilities` | `profiles`, shared `updated_at` trigger |
| `0003_school_setup` | branding, academic years, terms, classes, sections, subjects, grading scales, weekends, holidays |
| `0004_students` | students, private identifiers, contacts, enrollment history |
| `0005_teachers` | teachers, private identifiers, assignments, leave |
| `0006_routine_and_attendance` | routine periods, cancellations, teaching sessions, student attendance |
| `0007_device_attendance` | devices, device users, raw punches, shifts, derived daily attendance |
| `0008_exams_and_marks` | exams, exam subjects, marks, submissions, published results, class tests |
| `0009_fees` | fee types, rates, charges, payments, allocations, receipts |
| `0010_feedback` | campaigns, questions, targets, completions, anonymous responses and comments |
| `0011_documents_and_qr` | templates, QR tokens, admit-card rules and overrides, generated documents |
| `0012_library` | library books |
| `0013_notifications` | notification jobs, SMS delivery logs, OTP challenges, auth attempts |
| `0014_audit` | audit log and the generic trigger, attached to 41 tables |
| `0015_auth_helpers` | the `app.*` authorisation functions, `get_public_card`, `admit_card_eligibility` |
| `0016_rls_policies` | RLS enabled on every table; 131 policies |
| `0017_feedback_rpc` | `submit_feedback`, `feedback_analysis` |
| `0018_storage_buckets` | three buckets and their object policies |
| `0019_grants` | explicit table privileges; `anon` gets none |
| `0020_function_grants` | explicit function privileges; `anon` reaches one function |
| `0021_audit_actor_durability` | audit attribution survives account deletion |
| `0022_admission_rpcs` | atomic `create_student_record` / `create_teacher_record`, trigram search indexes |
| `0023_sms_log_job_optional` | an SMS delivery log may exist without a queued job (account OTP) |
| `0024_fix_assignment_effective_from` | nullif before the date cast in both admission RPCs |
| `0025_attendance_rpcs` | atomic `submit_attendance`, attendance statistics, `pending_attendance` |
| `0026_range_constructor_grants` | restores EXECUTE on `timerange` for routine constraints |
| `0027_fix_null_visibility_guard` | `owns_student_record` returns false not NULL; guard fails closed |
| `0028_unsubmitted_from_routine` | outstanding lessons derived from the routine, not from session rows |
| `0029_fee_rpcs` | atomic billing, payment recording, reversal, waiving, and fee summaries |
| `0030_exam_rpcs` | the `pass_rule` enum and grading-scale policy columns, `app.grade_for`, atomic `submit_marks`, `exam_submission_progress`, `publish_results`, `send_class_test_result`, `student_results` |
| `0031_grade_for_anon_revoke` | revokes `anon`'s default EXECUTE on `app.grade_for` |
| `0032_overall_grade_follows_result` | a failed term prints the failing grade, not the percentage's band |
| `0033_documents_rpcs` | `exam_seat_tokens`, feedback target generation, admit-card issue and override, QR issue/revoke, the printable payloads, and the ID card / admit card / result sheet templates |
| `0034_qr_token_comment_fix` | corrects what `issue_qr_token` says about the guardian phone |
| `0035_feedback_campaign_choice` | picks the open feedback round, not the oldest, when a term has several |

## Identity

### profiles

One row per `auth.users` id, carrying `role` and activation state. Every policy
resolves through it. No password material is stored here or anywhere else in
`public`.

`must_set_password` is `true` from provisioning until the account completes OTP
activation. The proxy confines such an account to `/activate`.

### Roles

`authority_admin`, `authority_staff`, `teacher`, `student`.

The admin/staff split is real, not decorative: publishing results, enabling
admit-card overrides, deleting branding and managing profiles require
`authority_admin`, while ordinary office work needs only `authority_staff`.

## Students

### Why sensitive identifiers sit in their own table

`student_private_ids` holds parent NIDs and the birth certificate number;
`teacher_private_ids` holds the teacher NID.

Postgres RLS is row-level only. There is no way to let a teacher read a student
row while hiding two of its columns, because Supabase exposes a single
`authenticated` role and column-level `GRANT`s cannot distinguish a teacher from
the authority. Splitting the table is the only enforceable answer. No teacher
policy and no student policy exists on these tables — only the authority can
read them.

The brief's "at least one parent NID, with the option to enter both" is a CHECK
constraint, not a form validation.

### Why there is no phone column on students

`student_contacts` holds the numbers, with a partial unique index ensuring
exactly one `is_sms_target` per student. The index on `phone` is deliberately
**not** unique, with a comment saying why: two siblings share one guardian
number, and that is the exact case the brief calls out.

Keeping contacts in their own table also means changing the SMS destination is
an ordinary audited row change rather than an edit to the student's identity.

### Enrollment history

`student_enrollments` carries class, section and roll per academic year, one row
per student per year, with roll unique within a section for that year.
Promotion **inserts** a row and links `promoted_from_id`; it never overwrites.
This is what preserves "which class was this student in during term 2 of 2025",
and it is why `published_results` references an enrollment rather than a class.

### Sections are required

The brief treats sections as optional. The model requires one per class, and the
seed creates a single section `A` per class. Reasons:

- Roll-number uniqueness needs a concrete parent. With a nullable `section_id`,
  `UNIQUE (year, section, roll)` would not constrain rows where section is NULL,
  because NULL never equals NULL.
- Routine, attendance, assignments and feedback all hang off a section. A
  nullable parent would mean every one of those tables needs two code paths.

The UI hides the section selector when a class has exactly one section, so this
is invisible to users. **Revisit this if the owner objects**, since it is the
one place the model deliberately differs from the brief.

## Attendance

### The distinction the module exists to preserve

```
routine_periods     the recurring weekly timetable
    │
    ├── cancelled_periods      a period called off on one date
    │
    └── teaching_sessions      one occurrence on one date
            │                   └── submitted_at  ← NULL means "not taken"
            │
            └── student_attendance   explicit per-student status
```

A lesson whose teacher has not submitted has **no** `student_attendance` rows.
The `attendance_status` enum deliberately has no `not_submitted` value, because
representing it as a status would invite code that treats a missing row as
absence.

`teaching_sessions` copies class, section, subject and teacher from the routine
at creation, so editing the routine later does not restate who taught a past
lesson.

### Teacher attendance from the K40

Raw and derived are strictly separated:

- `raw_punch_events` — immutable, exactly as the terminal reported, with a
  unique `dedupe_key`. Never edited.
- `teacher_daily_attendance` — recomputable summary. An authority correction
  sets `override_status` and a mandatory reason while leaving the
  machine-derived `status` in place for comparison.

Unmapped device user ids are kept with `teacher_id = NULL` and surfaced as a
warning rather than silently discarded.

No fingerprint template is stored. Templates stay on the terminal; this
database holds only the device-user-id to teacher mapping and the punch events.

## Exams

Authority term exams (`exams`) and teacher extra tests (`class_tests`) are
separate tables. They have different owners, permissions and notification
rules; merging them would make every policy on marks conditional on a `kind`
column.

`marks.marks_obtained` is nullable with `is_absent` separate, so "not entered
yet", "absent" and "scored zero" are three distinct states. A trigger rejects a
mark above the configured maximum.

`published_results.snapshot` freezes the subject-wise figures at publication. A
later mark correction does not rewrite a result sheet a parent already
received; reprinting produces the same paper.

`routine_published_at` and `results_published_at` are independent, because
students see an exam schedule long before any marks exist.

### Grading policy lives in the database

`grade_bands` holds the bands, one per grade per scale, with an exclusion
constraint over `numrange(min_pct, max_pct, '[]')` so a percentage can never map
to two grades. `app.grade_for(scale, pct)` is the single place a percentage
becomes a grade.

Three columns on `grading_scales` carry the rest of the policy:

| Column | What it decides |
| --- | --- |
| `pass_rule` | `all_subjects` (the owner's choice), `average`, or `allow_one_fail` |
| `fail_zeroes_gpa` | whether a failed term prints GPA 0.00 and the failing grade |
| `no_gpa_below_level` | the class level up to which marks and grades print but no GPA |

`exams.grading_scale_id` records the scale an exam was published under, so
changing the policy later cannot re-grade a past exam. The snapshot additionally
keeps `gpa_computed` and `grade_computed` — the marks-only figures — beside the
printed ones, so a zeroed result is always explainable from its own row.

Attendance on a result sheet comes from the **term's** `attendance_window_start`
/ `attendance_window_end`, not the academic year, and counts only lessons a
teacher actually submitted. A term with no window prints no attendance figure
rather than a figure computed over the wrong dates.

### Seat codes

`exam_seat_tokens` holds one random ten-character code per student per exam,
issued the first time an admit card is issued and reprinted identically
thereafter — so a reprint matches the card already in the student's hand. The
alphabet excludes I, O, 0 and 1, because the code is read off paper and typed by
hand at a hall door. It is stored rather than derived, because a code computed
from the student and exam ids would be guessable from a registration number,
which defeats the point of checking it.

## Feedback, and why anonymity is structural

```
feedback_targets      student_id + teacher_id   which forms a student must fill
feedback_completions  student_id                WHO has finished
feedback_responses    teacher_id only           WHAT was answered
feedback_comments     teacher_id only           the optional text
```

The split is the whole design. `feedback_responses` and `feedback_comments`
carry **no student column at all** — not a hidden one, not an encrypted one, not
a foreign key — so even a full database dump cannot attribute a rating.
Double submission is still prevented, because the uniqueness sits on
`feedback_targets.answered_at` and `feedback_completions`, which are allowed to
name students precisely because they hold no answers.

`feedback_responses.submitted_on` is a **date, not a timestamp**. A full
timestamp would let submission order be correlated against
`feedback_completions.updated_at` and re-identify who said what.

There is **no teacher policy** on either answer table, and none should ever be
added — not even for an aggregate view. `feedback_analysis` additionally guards
on `app.is_authority()` internally, so a teacher calling it gets an empty set
rather than their own averages.

The cost of this, which the UI states plainly: a submitted rating **cannot be
changed or withdrawn**, because nothing can find it again.

`app.gating_feedback_campaign(term)` decides which round gates a term's admit
cards: the open one, else the closed one, else the newest draft. Both
`admit_card_eligibility` and `default_admit_card_rule` use it, so the gate and
the rule that configures it cannot disagree.

## Admit cards and the public QR card

`admit_card_eligibility` is the single definition, and `issue_admit_card`
re-checks it inside its own transaction — so the office cannot issue a blocked
card from a different screen, which is the brief's explicit requirement. With no
`admit_card_rules` row the card is blocked, not issued: nothing is asserted to
be satisfied until the office configures it.

`qr_tokens.card_snapshot` is the entire public surface. It holds exactly the
fields the card's template declares, a trigger refuses the forbidden keys
regardless of what a template asks for — and that refusal holds even for the
service role — and the public page renders a deliberate **subset** of it, with
the guardian's phone number printed on the card but not published. A unique
partial index allows one live token per student, so issuing a replacement
revokes the previous card; `issue_qr_token` revokes before it inserts, because
the index would otherwise refuse the new row.

`generated_documents` is the issue log: what was produced, for whom, by whom
and when. It deliberately holds no file, because every PDF is generated on
demand from live data or a frozen snapshot.

## Fees

```
fee_charges  ←──┐
                ├── payment_allocations ──→ payments
                │
            receipts (one per payment, enforced by UNIQUE)
```

The allocation table carries the amounts because one payment can clear several
months and one charge can be settled by several payments.

`amount_paid` and `status` on `fee_charges` are maintained by trigger from
allocations, and reversed payments do not count towards clearance. `waived` and
`cancelled` are deliberate authority states the recalculation never overwrites.

Payments are reversed, never deleted, and a reversal requires a reason.

## Feedback

```
feedback_targets      which student must review which teacher   (student_id present)
feedback_completions  who has finished                          (student_id present)
feedback_responses    the ratings                               (NO student reference)
feedback_comments     the optional text box                     (NO student reference)
```

See [architecture.md](architecture.md#feedback-anonymity) for why.

`min_periods_taught` on a campaign supports the brief's question about a
minimum teaching threshold before a student reviews a teacher; the threshold
itself is an owner decision.

## Documents and QR

`qr_tokens.card_snapshot` is the entire public surface. A trigger rejects
forbidden keys. `qr_tokens` has a partial unique index giving each student at
most one live link, and `replaced_by_id` records lost-card reissues.

`admit_card_rules` is per exam and holds the feedback requirement, the monthly
fee window, the exam-fee requirement and the tolerated outstanding amount.
`allow_override` defaults to **false**.

## Notifications

`notification_jobs.dedupe_key` is unique — this is the idempotency guarantee,
not a convenience index. `segments` records billable SMS segments, with
`is_unicode` distinguishing 160-character GSM-7 from 70-character Bangla UCS-2.

`sms_delivery_logs.mode` is `live` or `simulate`, so a test run never looks
like real traffic in the logs. The adapter strips credentials from
`request_payload` before storing it.

`otp_challenges` stores a hash only; the plaintext code exists in memory just
long enough to hand to the provider. `auth_attempts` is the rate-limit ledger
and is readable by nobody — not even its own subject, because the attempt
counter is the state being protected.

## Known gaps

Things the model does not yet do, stated so they are not mistaken for done:

- No `student_photos` metadata beyond `photo_path` and `photo_bytes`; the
  200 KB limit is enforced on the storage bucket and must also be enforced in
  the upload form when that is built.
- `generated_documents` permits several scope columns to be set at once; the
  "exactly one scope" rule is currently a convention, not a CHECK constraint.
- `library_books.cover_image_path` and `cover_generated_at` are **obsolete**.
  The thumbnail design they served was cancelled by the owner in Phase 2; see
  [design-system.md](design-system.md#3-library-book-cards--revised-specification).
  Nothing writes to them, and the Library phase should drop them and add a
  `card_color` column instead.
- No materialised views for dashboard aggregates yet. Add them when the
  dashboard queries are written against real data volumes, not before.
