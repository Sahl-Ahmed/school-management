# School Management System

Three role-based portals — **Authority**, **Teacher** and **Student** — over one
connected database, for a school in Bangladesh. Times display in `Asia/Dhaka`;
amounts are in BDT.

> **Status: phases 1 to 6 complete, phase 7 part done.** The data model,
> permissions, accounts, admission, photo compression and OTP activation; the
> class routine and teacher-submitted attendance; fee billing, payment entry and
> receipts; term exams with mark entry, result publication and student results;
> anonymous teacher feedback, admit cards, ID cards, exam routines and result
> sheets; and the shared library are built and verified against a hosted
> Supabase project.
>
> **Two integrations are PENDING and are not claimed as working.** The owner has
> not opened an SMS provider account and has not bought the K40 fingerprint
> terminal. SMS message templates, rules, the queue, duplicate prevention and
> delivery reporting are all built and tested **in simulation**: messages are
> rendered, costed and recorded, and nothing reaches a phone. A simulated
> dispatch is marked *skipped*, never *sent*, so the delivery figures never
> describe messages that do not exist. Connecting a provider later is a
> credentials change, not a rewrite.
>
> **Every PDF renders Bangla correctly**, with Noto Sans Bengali embedded and
> real Indic shaping: routines, receipts, admit cards (three to an A4 sheet),
> exam routines, result sheets, and ID cards at PVC card size in both
> orientations.
>
> **Teacher feedback is anonymous by construction**, not by hiding a column: the
> tables holding ratings and comments have no student reference at all, so a
> rating cannot be traced — and equally cannot be withdrawn once submitted.
>
> The grading policy — bands, subject pass mark, pass rule and GPA convention —
> is configuration the authority edits at `/authority/grading`, not code. The
> owner has confirmed a standard GPA-5 scale where every subject must be passed,
> an admit-card fee cutoff of the exam's own month, and the ID card's printed
> fields; see [decisions-for-owner.md](docs/decisions-for-owner.md).
>
> **A cost trap worth knowing about.** Bangla cannot be sent as GSM-7, so a
> Bangla message is billed at 70 characters per segment against 160 for English.
> One character outside GSM-7 does the same to an English message: the shipped
> result template contained an em dash, which made a 96-character message cost
> two segments instead of one. The template editor now names any such character
> and states the saving.

## Quick start

```bash
npm install
npm run verify     # typecheck, lint, schema + seed check, 49 tests — no credentials needed
```

To run the app you need a Supabase project. Follow
[`docs/setup.md`](docs/setup.md) — it covers creating the project, pushing the
schema and creating the first authority account.

```bash
cp .env.example .env.local   # then fill in your Supabase values
npm run dev
```

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/setup.md](docs/setup.md) | Install, Supabase project creation, schema push, first account, troubleshooting |
| [docs/architecture.md](docs/architecture.md) | Stack and why, the security model, correctness invariants, testing approach |
| [docs/data-model.md](docs/data-model.md) | All 60 tables, the decisions worth questioning, known gaps |
| [docs/implementation-plan.md](docs/implementation-plan.md) | The nine phases and what "done" means for each |
| [docs/decisions-for-owner.md](docs/decisions-for-owner.md) | Eight open policy decisions, with current defaults |
| [docs/design-system.md](docs/design-system.md) | Palette, chart rules, and the revised Library card specification |

## How it is built

- **Next.js 16** (App Router) + React 19 + TypeScript
- **Supabase** Postgres, Auth, Storage, Row Level Security
- **Tailwind CSS 4**, **Zod 4**
- **Vitest + PGlite** — real Postgres in-process, so RLS policies are tested as
  policies. No Docker required.

### The one rule worth knowing

**Authorisation lives in the database.** Navigation guards and hidden menus are
usability, not security. The test suite proves this by signing in as a student
and querying another student's record directly — the database returns nothing.

Three Supabase clients exist and the distinction matters:
`client.ts` and `server.ts` act as the signed-in user and are subject to RLS;
`admin.ts` bypasses RLS and is `server-only`, for account provisioning, OTP, SMS
dispatch and device ingest.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (no credentials needed) |
| `npm run verify` | Typecheck + lint + schema/seed check + tests |
| `npm test` | 323 local tests (offline — never touches the network) |
| `npm run test:remote` | Access, Storage, OTP, exam, document and library tests against the hosted project |
| `npm run demo:accounts` | Restores the owner's demo logins (the remote tests reset their passwords) |
| `npm run test:remote:cleanup` | Removes the accounts the remote tests create |
| `npm run check:env` | Validates .env.local by shape without printing any value |
| `npm run report:remote-schema` | Read-only privilege and RLS audit of the live project |
| `npm run verify:migrations` | Apply all migrations to a throwaway Postgres |
| `npm run verify:seed` | Migrations + seed, with a row census |
| `npm run db:push` | Push migrations to the linked Supabase project |
| `npm run db:types` | Generate TypeScript types from the live schema |

## Repository layout

```
src/
  app/                  routes: /login, /activate, /card/[token],
                        /authority, /teacher, /student
  components/           shared UI
  lib/
    supabase/           the three clients + relation helper
    auth/identity.ts    registration number → Auth identity mapping
    auth/otp.ts         hashed one-time codes, expiry, rate limits
    sms/                provider adapter (simulate / live) + segment counting
    image/compress.ts   in-browser photo compression under 200 KB
    validation/         zod schemas shared by forms and server actions
    env.ts              validated environment
    phone.ts            Bangladeshi number normalisation
  proxy.ts              session refresh, role routing, activation gate

supabase/
  migrations/           19 SQL migrations — the schema's only source of truth
  seed.sql              synthetic demo data

tests/
  access-rules.test.mjs cross-role access and idempotency
  admission.test.mjs    admission RPC permissions, atomicity, siblings
  phone.test.ts         phone normalisation
  sms.test.ts           billable segment counting, including Bangla
  remote-*.test.ts      against the hosted project; skip without credentials
  sql/                  PGlite harness, Supabase shim, fixtures

docs/                   see the table above
scripts/                schema and seed verification
```

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS. It belongs in `.env.local` and
  your host's secret store, nowhere else. `.env.local` is gitignored.
- Parent NIDs and birth certificate numbers live in separate authority-only
  tables, because Postgres RLS cannot hide individual columns from one role.
- The public QR card page reads a frozen snapshot through a single function.
  `anon` holds no table privileges at all, and a database trigger refuses to
  store a snapshot containing parent names, NIDs, fees, marks or attendance.
- Teacher feedback is anonymous by construction: the tables holding answers have
  no student column and no foreign key to `students`. Completion is tracked
  separately so double submission is still prevented.
- All test data is synthetic. No real student, guardian, NID or fingerprint
  data appears anywhere in this repository, and none should.
