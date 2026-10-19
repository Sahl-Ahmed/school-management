# Setup

Everything here can be done on a fresh machine. Steps 1–3 need no Supabase
account; step 4 onwards does.

## What you need

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20.9+ | `node --version`. Developed on 24.18. |
| npm | 10+ | Ships with Node. |
| A Supabase account | — | Free tier is enough for testing. |
| Docker | *not required* | Only needed if you want to run Supabase locally. The tests do not need it. |

## 1. Install

```bash
npm install
```

## 2. Check the database schema without any credentials

The schema is verified against a real Postgres that runs inside Node (PGlite),
so this works before a Supabase project exists:

```bash
npm run verify:seed
```

This applies all 19 migrations plus the demo seed and prints a row census. It
is the fastest way to confirm a schema change is valid.

```bash
npm test
```

49 tests. The access-rule suite signs in as a student, a teacher and an
anonymous visitor and checks what the database actually permits.

## 3. Build

```bash
npm run verify
```

Runs type checking, linting, the schema check and the tests. The build itself
(`npm run build`) does not need Supabase credentials.

## 4. Create the Supabase project

1. Go to <https://supabase.com/dashboard> and create a new project.
   - **Region:** Singapore (`ap-southeast-1`) is the closest to Bangladesh.
   - **Database password:** generate a strong one and save it in a password
     manager. You need it in step 5 and you cannot read it back later.
2. Wait for provisioning to finish (a couple of minutes).
3. Open **Project Settings → API** and copy:
   - Project URL
   - `anon` / `public` key
   - `service_role` key — **secret**, see the warning below

### About the service_role key

It bypasses every Row Level Security policy in this system. Anyone holding it
can read every student record, every fee and every mark.

- Keep it only in `.env.local` and in your hosting provider's secret store.
- Never prefix it with `NEXT_PUBLIC_`.
- Never paste it into a client component, a browser console, or a chat.
- `.env.local` is already in `.gitignore`. Keep it there.

## 5. Configure the application

```bash
cp .env.example .env.local
```

Fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_PROJECT_REF=YOUR_PROJECT_REF
SUPABASE_DB_PASSWORD=the password from step 4
```

Leave `SMS_MODE=simulate`. In simulate mode the system records exactly what it
would have sent, in `sms_delivery_logs` with `mode = 'simulate'`, and contacts
no provider. Nothing is sent to a real phone until you deliberately change it.

## 6. Push the schema

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npm run db:push
```

`db:push` applies the 19 migrations in order. It will list them and ask for
confirmation.

To load the synthetic demo data as well:

```bash
npx supabase db push --include-seed
```

The seed is **synthetic only** — invented names and `+88013000001xx` phone
numbers that cannot reach a real subscriber. Do not put real student data in
it.

## 7. Generate database types

Once the schema is live, generated types replace the hand-written shapes in the
app:

```bash
npm run db:types
```

## 8. Create the first authority account

The authority creates every other account, so the first one is created by hand.

1. In the dashboard, go to **Authentication → Users → Add user**.
2. Enter a real email address and a password. Tick **Auto Confirm User**.
3. Copy the new user's UUID.
4. Open **SQL Editor** and run, with your own UUID and name:

```sql
insert into public.profiles (id, role, full_name, must_set_password, activated_at)
values ('PASTE-UUID-HERE', 'authority_admin', 'Your Name', false, now());
```

The `must_set_password = false` matters: the proxy sends any account with it
set to `true` to `/activate`, and the OTP activation flow is not built yet.

## 9. Run it

```bash
npm run dev
```

Open <http://localhost:3000>, choose the **Authority** tab and sign in with the
email and password from step 8.

## What works right now

Phase 1 delivered the foundation, not the features. Specifically:

- **Working:** sign-in for all three roles, role-based routing, the authority
  dashboard counters (live queries), the teacher's assignment list, the student
  profile and fee total, and the public QR card page.
- **Not built:** every screen marked with a phase number in the portal
  navigation. Those items are greyed out rather than linked, so nothing looks
  finished that is not.
- **Not connected:** SMS (simulate mode only, no provider credentials), and the
  K40 fingerprint terminal (no bridge service yet).

See [`docs/implementation-plan.md`](implementation-plan.md) for what each phase
covers.

## Troubleshooting

**`Missing or invalid public environment variables`** — `.env.local` is missing
or incomplete. The build does not need credentials, but running the app does.

**`permission denied for table ...`** — expected. RLS is doing its job. Check
which role the signed-in user has in `public.profiles`.

**`supabase link` asks for a database password** — it is the one from step 4,
not your Supabase account password. Reset it under **Project Settings →
Database** if it is lost.

**A migration fails on push** — run `npm run verify:migrations` first. It
applies the same files locally and names the failing one.
