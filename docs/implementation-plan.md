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

## Phase 2 — Admission and activation

**Build**
- Add Student: full form, with browser-side photo compression below 200 KB and
  server-side size validation.
- Add Teacher, including the device user id field and the distinct-finger count.
- Class and subject management; promotion between academic years.
- OTP activation: issue, verify, set password, for both students and teachers.
- Forgot-password over OTP.
- Account provisioning via the Admin API with `must_set_password = true`.

**Done when**
- A student created by the office can activate on a phone and sign in.
- Both siblings activate independently on the same guardian number.
- A photo over 200 KB is rejected server-side, not only in the browser.
- OTP is rate-limited and codes are stored hashed.
- Promotion preserves the previous year's enrollment row.

**Needs:** SMS in simulate mode is enough to develop; a real OTP needs provider
credentials (decision 7).

## Phase 3 — Routine and attendance

**Build**
- Routine builder per class/section with clash detection surfaced in the UI.
- Teaching-session creation and attendance submission by teachers.
- Correction flow with a mandatory reason.
- Student and authority attendance views, by month and by subject.
- Overdue-submission list for the authority.
- Dashboard charts from real aggregates.

**Done when**
- An unsubmitted lesson never counts as an absence anywhere in the product.
- A teacher cannot submit for a section they are not assigned to (already
  enforced by RLS; needs UI coverage).
- Clashes are refused with a readable message rather than a constraint error.
- Corrections appear in the audit log with their reason.

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
- Library CRUD, publish/unpublish, cover generation from the PDF first page.
- `sms.bd` adapter behind the provider interface.
- Daily attendance summary job: eligibility, body composition, segment
  counting, dispatch, delivery-status reconciliation.
- Authority views of pending, sent and failed messages.

**Done when**
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
