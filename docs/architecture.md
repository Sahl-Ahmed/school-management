# Architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript | Server Components keep student records on the server; Server Actions give mutations a single server-side entry point; one deployable covers all three portals and the public QR page. |
| Database | Supabase Postgres | Chosen in the brief. Row Level Security lets the permission model live next to the data instead of only in application code. |
| Auth | Supabase Auth | Password hashing, session rotation and refresh tokens already solved. No password ever reaches this codebase. |
| Styling | Tailwind CSS 4 | Utility CSS with design tokens; print rules for A4 and PVC outputs live beside screen styles. |
| Validation | Zod 4 | One schema validates a form on the client and the same payload on the server. |
| Tests | Vitest + PGlite | PGlite runs real Postgres in-process, so RLS policies are tested as policies rather than through the UI. No Docker needed. |

### Why not a separate API server

Every write already needs a server-side authorisation decision, and Server
Actions provide exactly one place to make it. Adding a separate API would mean
maintaining two authorisation surfaces and two deployment targets for no gain
at this scale.

## Portability

The brief asks that hosted Supabase remain usable if the website moves
elsewhere, with deliberate migration later.

- All schema lives in `supabase/migrations/` as plain SQL. Nothing is created
  through the dashboard, so the schema is reproducible from the repository
  alone.
- The app talks to Supabase only through `src/lib/supabase/*`. Those three
  files are the entire coupling surface.
- Postgres features are standard: no Supabase-specific SQL beyond `auth.uid()`
  and the `storage` schema, both of which the shim in `tests/sql/supabase-shim.sql`
  shows how to replace.
- Deployment is an ordinary Next.js app and is independent of where Postgres
  lives.

## Security model

### The rule

**Every read and write is authorised by the database, not by the application.**

Navigation guards and hidden menu items are usability, not security. The test
suite asserts this directly: it signs in as a student and queries another
student's record, and the database returns nothing.

### Layers

```
┌────────────────────────────────────────────────────────────────┐
│ Browser              anon key only; no secrets; no admin client │
└───────────────────────────────┬────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────┐
│ src/proxy.ts         session refresh, role routing, activation  │
│                      gate.  NOT authorisation.                  │
└───────────────────────────────┬────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────┐
│ Server Components    request-scoped client; acts AS the user    │
│ + Server Actions     so RLS applies to every query              │
└───────────────────────────────┬────────────────────────────────┘
                                │
┌───────────────────────────────▼────────────────────────────────┐
│ Postgres             RLS policies + CHECK constraints +         │
│                      exclusion constraints + audit triggers     │
└────────────────────────────────────────────────────────────────┘
```

### Three Supabase clients, used deliberately

| File | Acts as | Use for |
| --- | --- | --- |
| `lib/supabase/client.ts` | the signed-in user | browser components |
| `lib/supabase/server.ts` | the signed-in user | Server Components, Server Actions — **the default** |
| `lib/supabase/admin.ts` | service role, **bypasses RLS** | account provisioning, login identity lookup, OTP, SMS dispatch, K40 ingest |

`admin.ts` starts with `import "server-only"`, so importing it from a client
component fails the build rather than leaking the key.

### How roles are resolved

`public.profiles` holds one row per auth user carrying the role. Policies never
read a role from the client; they call `app.caller_role()`, which reads
`profiles` as `SECURITY DEFINER` so it does not recurse through RLS.

Helpers are `STABLE` and policies wrap them as `(select app.is_authority())`.
The subquery wrapper lets Postgres evaluate the helper once per statement
rather than once per row — the difference between a fast and an unusable
students table.

### Teacher scope

A teacher's access is derived entirely from `teacher_assignments`, never from a
class or section id supplied by the client. `app.teaches_student()` and
`app.teaches_section_subject()` are the only paths, and they check effective
dates, so a mid-term teacher change does not retroactively grant or revoke
access to the earlier part of the term.

### Student login without a unique phone

Two siblings legitimately share one guardian phone number, so the phone cannot
be an account identifier. The registration number is, and it is unique,
permanent, and survives promotion.

Supabase Auth keys accounts by email, so `lib/auth/identity.ts` maps a
registration number to a synthetic address on the RFC 2606 reserved `.invalid`
TLD — `s-<uuid>@students.school.invalid`. No mail is ever sent there; the
address exists only because Auth needs a unique key. It is derived from the row
uuid rather than the registration number, so correcting a mistyped registration
number does not disturb the auth identity.

Login failures return one message for both "no such registration number" and
"wrong password". Registration numbers are printed on ID cards, so a
distinguishing error message would turn the login form into a lookup service.

### The public QR card

This is the only surface anonymous visitors reach, and it is deliberately
narrow:

- `anon` holds **no table privileges at all** (migration 0019). The only thing
  it may call is `public.get_public_card(token)`.
- That function returns `qr_tokens.card_snapshot` — a frozen copy of the fields
  printed on the physical card — plus school branding. It joins to no student,
  contact, fee, mark or attendance table, so a future policy mistake on those
  tables cannot widen what a scan reveals.
- A `BEFORE INSERT` trigger rejects a snapshot containing `father_name`,
  `mother_name`, any NID, a birth certificate number, fees, marks, GPA or
  attendance. Exclusion is enforced in the database, not only in the template.
- Tokens are opaque and random, never derived from a registration number, and
  revocable, so a lost card's link can be killed and reissued.

### Feedback anonymity

Anonymity is structural rather than a hidden column:

- `feedback_completions` records **that** a student submitted (student id
  present, no answers).
- `feedback_responses` and `feedback_comments` record **what** was answered —
  and have no student column and no foreign key to `students` at all.

A full database dump cannot attribute a rating. Double submission is still
prevented, because the uniqueness constraint sits on the completions table.
Students hold no INSERT privilege on either answers table; `submit_feedback()`
writes both halves in one transaction and takes the rated teacher from the
target row rather than from the client.

Teachers have **no policy** on the answer tables, at any aggregation. Timestamps
on responses are stored as a date rather than a full timestamp, because
submission order could otherwise be correlated against completions to
re-identify a student.

The accepted trade-off: an individual rating can never be retracted or
corrected, because nobody can find it again.

## Correctness invariants

These are the rules the schema enforces structurally, so no code path can skip
them.

### Unsubmitted attendance is not absence

A lesson is a `teaching_sessions` row with its own `submitted_at`. Until a
teacher submits, there are **no** `student_attendance` rows for that lesson.
Absence is only ever recorded explicitly. Attendance percentages count
submitted lessons only; the daily SMS refuses to send while any scheduled,
non-cancelled period for that student is unsubmitted.

### Exactly one daily SMS per student per day

`notification_jobs.dedupe_key` is `UNIQUE` and built as
`daily_attendance|<student_id>|<date>`. A re-run of the scheduler, an
overlapping cron or a manual retry fails on the index instead of sending a
second message. The same mechanism guards result and class-test SMS, and
`class_tests.result_sent_at` is checked before dispatch so a double click cannot
send twice.

### Duplicate K40 punches cannot inflate attendance

`raw_punch_events.dedupe_key` is `UNIQUE` and built from
`device|user|timestamp|state`. When the on-site PC comes back online and the
bridge replays the terminal's backlog, re-importing is a no-op. Raw events are
immutable; derived daily summaries live in `teacher_daily_attendance` and are
recomputable, with authority corrections recorded next to the machine reading
rather than overwriting it.

### No double billing

A partial unique index on `fee_charges` over
`(student, fee type, year, period year, period month, exam)` makes a second
charge for the same period impossible. `amount_paid` is maintained by trigger
from `payment_allocations`, and a payment cannot be allocated beyond its own
value.

### One admit-card verdict

`public.admit_card_eligibility(student, exam)` is the single definition, called
by the student portal, the office search screen and the issue action alike, so
no screen can bypass it. With no rule configured for an exam it returns
**blocked**, not eligible — a missing policy must not silently become
permission. Overrides are off unless the owner enables them per exam, require
`authority_admin`, and are recorded in `admit_card_overrides` plus the audit log.

### Nobody is double-booked

Exclusion constraints using `btree_gist` prevent overlapping routine periods
for the same section or the same teacher, overlapping effective-dated teacher
assignments for one section/subject, overlapping approved leave, and
overlapping grade bands within one scale.

## Audit

A generic trigger (`app.audit_row_change`) is attached to 40 tables covering
fees, marks, attendance, enrollment, permissions and document eligibility. It
is a database trigger rather than application code precisely so that no code
path — including a manual change in the Supabase SQL editor — can skip it. It
records only genuinely changed columns, and skips hashed secrets.

`feedback_responses` and `feedback_comments` are deliberately **not** audited:
an audit row carrying `auth.uid()` next to an anonymous rating would defeat the
anonymity the model exists to provide.

## Time and money

Timestamps are `timestamptz`, stored in UTC and displayed in `Asia/Dhaka`.
Dates that are school-day concepts — attendance dates, fee periods, exam dates —
are `date`, so a timezone shift cannot move a lesson to the previous day.
Amounts are `numeric`, never floating point, and in BDT.

## Testing approach

`tests/sql/harness.mjs` boots PGlite, applies a small Supabase shim
(`tests/sql/supabase-shim.sql`) and then all 19 migrations. `asUser()` issues
`set role authenticated` with a JWT claim — the same thing PostgREST does per
request — so policies are exercised for real.

Known limits of this harness, which matter when reading a passing test:

- `auth.users` and `storage.*` are shims, not the real platform tables.
- PGlite is single-connection, so these tests say nothing about concurrency.
- Storage object policies are defined but not exercised, because the shim does
  not run the Storage API.
