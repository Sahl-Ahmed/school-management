# School Management System

Three role-based portals — **Authority**, **Teacher** and **Student** — over one
connected database, for a school in Bangladesh. Times display in `Asia/Dhaka`;
amounts are in BDT.

> **Status: phase 1 of 9 complete.** The data model, permissions, accounts and
> portal shell are built and tested. Feature screens are not. Greyed-out items
> in the portal navigation are not built yet — they are labelled with the phase
> that delivers them rather than linked to a page that 404s.
>
> SMS is in simulate mode (nothing is sent). The K40 fingerprint terminal has
> no bridge yet and is untested against hardware.

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
| `npm test` | 49 tests |
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
    env.ts              validated environment
    phone.ts            Bangladeshi number normalisation
  proxy.ts              session refresh, role routing, activation gate

supabase/
  migrations/           19 SQL migrations — the schema's only source of truth
  seed.sql              synthetic demo data

tests/
  access-rules.test.mjs cross-role access and idempotency (39 tests)
  phone.test.ts         phone normalisation (10 tests)
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
