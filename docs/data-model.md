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
