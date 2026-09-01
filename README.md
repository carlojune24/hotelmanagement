# MM Hotel

Multi-hotel management & online-booking platform. One deployment serves many
properties; each hotel is reached at `/{slug}/…`. Built as a pnpm monorepo so the
HR and finance domain models are portable, versioned standards other apps can
consolidate against.

- `apps/hotel` — the SvelteKit application (Svelte 5, Tailwind v4, Drizzle + Postgres).
- `packages/hr-core` — canonical org / employee / schedule / payroll models + PH statutory tables.
- `packages/finance-core` — chart of accounts, double-entry journal, cash-movement model, reports.
- `packages/integration` — versioned REST + event contract; shared primitives.
- `docs/standards/` — the HR and finance data contracts (source of truth).
- Implementation plan: `~/.claude/plans/lets-plan-this-out-logical-dragonfly.md`.

## Prerequisites

- Node 20+ and pnpm 11+
- A PostgreSQL 16+ database. Either:
  - **Docker**: `docker compose up -d` (uses `postgres://mmhotel:mmhotel@localhost:5432/mmhotel`), or
  - **Existing Postgres**: create a database and set `DATABASE_URL` in `apps/hotel/.env`.

## Setup

```bash
pnpm install
cp apps/hotel/.env.example apps/hotel/.env    # adjust DATABASE_URL if not using Docker
pnpm db:up                                     # start the Docker Postgres (skip if using your own)
pnpm db:migrate                                # apply migrations in apps/hotel/drizzle
pnpm db:seed                                   # create the demo hotel + admin/manager logins
pnpm dev                                        # http://localhost:5173
```

`pnpm db:seed` prints the seeded logins:

- Platform admin — `admin@example.com` / `admin12345` → `/admin`
- Hotel manager — `manager@example.com` / `manager12345` → `/hotel1/dashboard`

## Common scripts

| Command | What |
|---|---|
| `pnpm dev` | Run the app |
| `pnpm test` | Unit tests across the workspace |
| `pnpm check` | Type-check every package and the app |
| `pnpm db:generate` | Generate a new SQL migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:push` | Push schema directly (dev only) |
| `pnpm db:studio` | Drizzle Studio |

## Phase status

Phase 0 (foundation) is in place and verified end-to-end: monorepo, auth (cookie
sessions + Argon2id), path-based multi-tenancy with route guards, the platform-admin
area (add/configure hotels, manage members and users, invites), the staff app shell,
and an audit log.

The full build checklist — Phase 0 loose ends through Phase 6 (booking/PayMongo,
housekeeping/amenities, finance, HR/payroll, accounting, group consolidation) — is in
[`docs/TODO.md`](docs/TODO.md).
