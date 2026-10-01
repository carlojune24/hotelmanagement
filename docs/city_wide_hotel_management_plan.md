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

## Modules
1. **Registration & central management** — registration applications, permits, approval; hotel/user
   management copied from `/admin`.
2. **Tourism monitoring** — arrivals, occupancy, seasonality, per-district view.
3. **Tourist statistics** — origin/nationality, length of stay, party size, trends.
4. **Hotel ratings** — per-hotel and city-wide roll-up (approved reviews), shown on root `/`.
5. **Income analysis & reports** — revenue, ADR, RevPAR, tax-relevant totals; exports.

## Design
Run the `impeccable` skill and get direction approved before building any UI (root hotel list and the
`/city` shell/dashboards). Record it in `apps/hotel/PRODUCT.md` / `DESIGN.md` for this branch.

## Roadmap
- **Phase 0** — branch, this doc, `hotels_city` DB (cloned), city drizzle config + `city:dev`.
- **Phase 1** — design direction; `/city` copy of admin; root hotel list + ratings.
- **Phase 2** — registration applications; income and tourist-statistics reports.
- **Phase 3** — ratings roll-up; tourism dashboard; exports.

## Open questions
- Signed-in users currently redirect away from `/`; show the hotel list to everyone with a "my dashboard" link?
- How does real hotel data reach `hotels_city` after the one-time clone (sync, push, or each hotel's API)?
- Who is the city user (LGU tourism office, DOT, private association)?
