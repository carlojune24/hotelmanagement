# City-wide hotel management plan

Branch: `city` (long-lived). Database: `hotels_city` (separate from `mmhotel`).

## Purpose
A city/LGU layer on top of the hotel platform for:
- tourism monitoring
- tourist statistics
- hotel ratings
- overall income analysis and reports
- free hotel registration and centralized management

## Branch rules (read first)
1. `city` **only pulls from `main`. It is never merged into `main`.** No PRs from `city` to `main`.
2. **Do not touch** `/admin` (platform admin) or `/{hotel}/management` (tenant). `/{hotel}` is unchanged.
   On this branch `/admin` is **deferred**: its files are left as-is (so merges from `main` stay clean) but
   `hooks.server.ts` redirects `/admin/*` to `/city/*`, which replaces it. To bring it back, delete that redirect block.
3. Flow: `Jade -> main -> city`. Jade work reaches `city` only after it lands in `main`.
4. Sync procedure (merge, not rebase — shared long-lived branch):
   ```
   git checkout city
   git fetch origin
   git merge origin/main
   pnpm install
   # migrate main's new migrations onto the city DB, then city-only ones
   pnpm --filter @mm/hotel city:db:migrate-main && pnpm --filter @mm/hotel city:db:migrate
   pnpm -r check
   git push
   ```
5. Keep shared-file edits on this branch small (root `+page`, `tenant.ts` reserved slug, `PRODUCT.md`).
   City agent notes live in `apps/hotel/src/routes/city/CLAUDE.md`, not the root `CLAUDE.md`.
6. Protect `main` on GitHub (require PR + review) to prevent an accidental merge/push from `city`.

## Architecture
**The city instance is the same codebase pointed at `hotels_city`.** The `city` branch runs as its own
instance (own port, own `.env.city`) with `DATABASE_URL` = `hotels_city`. Every query — including the
helpers copied `/city` pages call (`seedHotelAmenities`, `seedFinanceDefaults`, `seedDefaultRoles`,
`writeAudit`) — hits the city DB automatically, so nothing can write into `mmhotel` by accident. The normal
instance keeps `DATABASE_URL` = `mmhotel` and is unaffected.

- `/city` routes: new folder `apps/hotel/src/routes/city/`, a copy of `/admin`'s pages (hotels, users,
  api-keys, errors) plus city features. Platform admins are the city superadmins.
- Root `/` shows the list of hotels with their ratings.
- `hotels_city` = a one-time clone of `mmhotel` (so no test data is re-entered) + city-only tables.
  After the clone the databases diverge. How real hotel data reaches city later is deferred.
- City-only tables (registration applications, permits, saved reports, tourism data) live in
  `src/lib/server/db/schema/city/` (not re-exported from `schema/index.ts`) with their own migrations
  folder `apps/hotel/drizzle-city/` and migrations table. Main's `drizzle/` journal is never edited.

## Modules (status)
1. **Registration & central management — built.** `/city` has the same functions as `/admin` (hotels, users,
   API keys), so the city creates hotels itself. Flow: city staff enter an application at `/city/apply` →
   review it in `/city/applications` → once the city **approves and finalizes** it, the hotel is created
   (via the copy of the create-hotel action, which seeds amenities, finance defaults and roles) and the
   application is linked to the new hotel. **Permits** (`/city/permits`) track each hotel's current permit
   (the one expiring latest), renewals as history, and Valid / Expiring soon / Expired / None status; a
   finalized application's permit is copied across automatically. On the city instance this creates the
   hotel in `hotels_city` (its own DB). *Not built:* approval/rejection emails, permit-scan uploads,
   expiry reminders, a public application form (applications are entered by city staff).
2. **Tourism monitoring — built.** `/city` **Overview** pulls the headline figures from every report onto one
   dashboard (guests, occupancy, revenue, rating, charts, "needs attention", hotels at a glance), and
   `/city/reports/occupancy` has occupancy, **ADR and RevPAR** (moved here from income: they are stay-night
   measures, not cash), seasonality by month and per hotel. *Not built:* per-district view (hotels only
   have a free-text `city`).
3. **Tourist statistics — partly built.** `/city/reports/guests`: guests, stays, guest-nights, average
   stay, per-hotel and consolidated charts, CSV. *Not built:* origin/nationality — guests have no such field,
   so it would need a change to the booking form in `main`.
4. **Hotel ratings — built.** Public register at `/` (published hotels, rooms, rating) and
   `/city/reports/ratings` (ranking, distribution, hotel-approval backlog, latest reviews). Ratings are the
   mean of approved reviews, the same rule everywhere.
5. **Income analysis & reports — built.** `/city/reports/income`: cash-basis revenue by hotel and month,
   same definition as each hotel's own Finance report (voided excluded, deposits included, refunds shown
   separately), chart, table, CSV.

All reports share one period filter (presets or a custom range, up to 5 years) and a CSV export.

## Design
Run the `impeccable` skill and get direction approved before building any UI (root hotel list and the
`/city` shell/dashboards). Record it in `apps/hotel/PRODUCT.md` / `DESIGN.md` for this branch.

## Roadmap
- **Phase 0 — done:** branch, this doc, `hotels_city` DB (cloned), city drizzle config + `city:dev`.
- **Phase 1 — done:** design direction; `/city` copy of admin (with `/admin` redirected to it); root hotel list + ratings.
- **Phase 2 — done:** registration applications and permits; income, guests, ratings and occupancy reports.
- **Phase 3 — done:** overview dashboard; demo data (hotels, bookings, reviews, payments).
- **Next:** real data feed from hotels into `hotels_city`; nationality capture (needs `main`); per-district
  grouping; emails and reminders; deploying the city instance.

## Running it
- Start the city instance: `cd apps/hotel && pnpm city:dev` (port 5174, database from `.env.city`). A plain
  `vite dev` uses `.env` (the `mmhotel` database), which has none of the city tables.
- After merging `main`: `pnpm city:db:migrate-main` then `pnpm city:db:migrate`.
- Demo data (only `demo-*` hotels, only on a `*_city` database, never touches `mmhotel`):
  `pnpm city:seed:demo` (hotels, rooms, guests, bookings, reviews), then `pnpm city:seed:income` (payments and
  refunds, written through the app's own `recordCashMovement` with back-dated business dates, so cash balances
  and the ledger stay correct); `pnpm city:seed:clear` removes all of it.

## Open questions
- How does real hotel data reach `hotels_city` after the one-time clone (sync, push, or each hotel's API)?
- Who is the city user (LGU tourism office, DOT, private association)? Drives the auth model.
- Nationality / origin statistics need a guest field added in `main`'s booking form — wanted?
- Signed-in users are no longer redirected away from `/`; they get a "My dashboard" link instead (decided; revisit if unwanted).
