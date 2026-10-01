# City-wide hotel management plan

Branch: `city` (long-lived). Database: `hotels_city` (separate from the hotel DB).

## Purpose
A city/LGU layer on top of the hotel platform for:
- tourism monitoring
- tourist statistics
- hotel ratings
- overall income analysis and reports
- free hotel registration and centralized management

## Branch rules (read first)
1. `city` **only pulls from `main`. It is never merged into `main`.** No PRs from `city` to `main`.
2. `/{slug}` (guest booking + staff app) is owned by `main` / `Jade`. Do not change it here;
   city needs go through additive code in `apps/city` and `packages/city-core`.
3. Flow: `Jade -> main -> city`. Jade work reaches `city` only after it lands in `main`.
4. Sync procedure (merge, not rebase — shared long-lived branch):
   ```
   git checkout city
   git fetch origin
   git merge origin/main
   pnpm install && pnpm -r check
   git push
   ```
5. Keep shared-file edits (`package.json`, `pnpm-workspace.yaml`, root `CLAUDE.md`,
   `apps/hotel/**`) to a minimum to keep merges conflict-free. City agent notes go in `apps/city/CLAUDE.md`.
6. Protect `main` on GitHub (require PR + review) to prevent an accidental merge/push from `city`.

## Architecture
- `apps/city` — new SvelteKit app (own routes, layout, auth, design world), run as its own server/port.
  Only city-management routes live here; hotels stay at `/{slug}` in `apps/hotel`. A reverse proxy can
  put both under one domain in production.
- `packages/city-core` — shared city types, snapshot contract, aggregation logic.
- Existing packages (`hr-core`, `finance-core`, `integration`) are consumed, not modified.
- **Database `hotels_city`**: new role, local PG18 on :5432, own `drizzle.config` + `migrations/`,
  env `CITY_DATABASE_URL`. No shared migration journal and no cross-DB queries.

## Data flow and privacy
- City never reads hotel tables directly. Hotels **opt in** and deliver **aggregated, anonymised
  snapshots** (nightly: occupancy, room-nights, revenue in centavos, stays by origin/nationality
  bucket, length of stay).
- Ratings only from verified completed stays (based on the hotel `reviews` model).
- Money is integer centavos; business dates resolved with each hotel's IANA timezone (same as main).
- Before collecting any guest-level data, review PH Data Privacy Act and DOT reporting requirements.
- Delivery mechanism (decide in Phase 1): hotel pushes to a city ingest endpoint with a per-hotel
  API key (reuse `api-keys.ts` / `packages/integration` pattern), or city pulls from each hotel API.

## Modules
1. **Registration & central management** — tenant creation stays in `/admin` of the hotel app
   (unchanged, owned by `main`). City never creates tenants. The city app handles the free-registration
   *application*: applicant details, permits, review/approval status. Once approved, a platform admin
   creates the hotel in `/admin`; the city record is then linked to that hotel by its slug/id, and
   the hotel starts sending snapshots. The hotel is served at `/{slug}` by the hotel app as usual.
   Reserve `city` as a hotel slug in `main`.
2. **Tourism monitoring** — arrivals, occupancy, seasonality, per-district view.
3. **Tourist statistics** — origin/nationality, length of stay, party size, trends.
4. **Hotel ratings** — per-hotel and city-wide roll-up, verified stays only.
5. **Income analysis & reports** — revenue, ADR, RevPAR, tax-relevant totals; exportable reports.

## Design
City is a **third design world**. Run the `impeccable` skill and get the direction approved
before building any UI. Record it in `apps/city/PRODUCT.md` / `DESIGN.md`.

## Roadmap
- **Phase 0** — branch, this doc, `hotels_city` DB, `apps/city` scaffold.
- **Phase 1** — city schema, registration flow, snapshot ingestion contract.
- **Phase 2** — income and tourist-statistics reports.
- **Phase 3** — ratings roll-up.
- **Phase 4** — tourism dashboard, exports, central management tools.

## Open questions
- Who is the city user (LGU tourism office, DOT, private association)? Drives the auth model.
- Snapshot delivery: push vs pull (see Data flow).
- Is hotel participation voluntary or mandated by the city? Affects the opt-in model.
