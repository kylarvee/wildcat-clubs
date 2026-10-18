# Wildcat Clubs

The all-in-one platform for Weber State student clubs — **find, found, run and retire** a club in
one place. Students browse and join clubs, check in to meetings with a QR scan, and build a
LinkedIn-style record of their club roles. Leaders plan events, budgets, org charts and elections.
Advisors and WSUSA administrators review clubs, set policy, run officer training and tests, and see
analytics for every club.

* `apps/web` — the web app and the API (Next.js + Postgres)
* `apps/mobile` — the simplified mobile app (Expo): QR check-in, notifications, clubs, calendar
* `ARCHITECTURE.md` — principles, permission hierarchy, who-inputs-what, definitions, decisions
* `docs/spec.md` — the product spec

## Run it locally

Requirements: Node 22+, PostgreSQL 16 (Homebrew: `brew install postgresql@16 && brew services start postgresql@16`).

```bash
createdb wildcat_clubs
```

```bash
cd apps/web && cp .env.example .env
```

Set `DATABASE_URL` in `apps/web/.env` (for Homebrew Postgres: `postgresql://$USER@localhost:5432/wildcat_clubs?schema=public`), then:

```bash
npm --prefix apps/web install
```

```bash
npm --prefix apps/web run db:reset
```

```bash
npm --prefix apps/web run dev -- --port 3100
```

Open http://localhost:3100 and sign in as any **test persona** (new student, member, officer, VP,
president, ambassador, founder, alumni, advisor, invited advisor, admin, sysadmin). Each is a seeded
account with real history — see `apps/web/prisma/seed/PERSONAS.md` for what to try with each.

`db:reset` wipes the database and re-seeds the full mock data set (~46 clubs, ~500 people, two years
of events and attendance). Run it any time to start user testing fresh.

Test personas need no password, so they exist only in development. A production build
(`next build && next start`) offers Google sign-in only, whatever `AUTH_MODE` says, unless
`ALLOW_TEST_SIGNIN=1` is also set — do that only on a demo or user-testing server.

## Without any external accounts

Everything works with no Google or Anthropic setup: test personas sign in, emails and push
notifications are recorded in **System → Outbox**, files are stored on disk, chat is in-app, and
calendars publish subscribable ICS feeds. Turn on each integration in **System → AI & integrations**
after adding its credentials (see `apps/web/.env.example` and ARCHITECTURE.md §8).

## Checks

```bash
npm --prefix apps/web run typecheck
```

```bash
npm --prefix apps/web test
```
