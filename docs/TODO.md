# MM Hotel — build checklist

Living task list. Mirrors the plan (`~/.claude/plans/lets-plan-this-out-logical-dragonfly.md`).
Check items off as they land. `[~]` = partially done / stubbed.

---

## Phase 0 — Foundation ✅ (done, verified end-to-end 2026-08-31)

- [x] pnpm monorepo: `apps/hotel` + `packages/{hr-core,finance-core,integration}`
- [x] `docs/standards/{hr,finance}.md` first drafts + `@mm/integration` primitives & events
- [x] Drizzle + local Postgres wiring, `.env.example`
- [x] Schema: `hotels`, `hotel_groups`, `users`, `memberships`, `sessions`, `invites`, `audit_log`
- [x] Auth: Argon2id passwords, opaque cookie sessions, login / logout / accept-invite
- [x] Tenant resolution + guards in `hooks.server.ts`; reserved prefixes; `scopedDb` helper
- [x] Platform admin: hotels list + create, config wizard, publish/archive, members (invite/role/remove), users (invite platform admin, enable/disable), audit-log rows
- [x] Staff app shell for `/{slug}` with role-aware nav; empty dashboard
- [x] `seed.ts` (platform admin, demo hotel `hotel1`, hotel manager)
- [x] Unit tests (slug rules, RBAC, standard primitives) + typecheck green

### Phase 0 loose ends (do before/with Phase 1)
- [x] `git init` + initial commit + push to a remote
- [ ] Password reset flow (request + token email + set new password) — currently only login/invite
- [ ] `scopedDb(hotelId)` actually enforced (helper exists; wire a lint rule / query wrapper)
- [ ] Rate-limit login + invite-accept (basic in-memory or `pg-boss`-backed)
- [ ] Global error page (`src/routes/+error.svelte`) + `handleError` hook
- [ ] CI: run `pnpm check` + `pnpm test` on push
- [ ] Playwright harness + first e2e (login → admin → create hotel)

---

## Phase 1 — Core PMS + Online Booking + PayMongo (MVP)

### UI foundation (do first) ✅
- [x] `pnpm dlx shadcn-svelte@latest init` in `apps/hotel`; wire its CSS variables to the existing `src/app.css` theme tokens (surface/ink/border/brand/danger/ok, light + dark)
- [x] Add the primitives Phase 1 needs: button, input, select, label, dialog, dropdown-menu, popover, calendar/date-picker, table, badge, sonner (toast), form
- [x] Migrate current `$lib/components/ui.ts` recipes + existing admin/auth screens to shadcn components; delete `ui.ts` once nothing imports it
- [x] Toast on every form action result (replace inline `form?.ok` / `form?.error` banners)

### Inventory & rates
- [x] Schema: `room_types`, `rooms`, `rate_plans`, `daily_rates`, `taxes_fees` (reservation fee, resort fee, VAT), `cancellation_policies`
- [x] Schema: `amenities` (per-hotel master, category + scope), `hotel_amenities`, `room_type_amenities` (`is_highlighted`) — informational only; seeded from `STANDARD_AMENITIES` on hotel create. Replaced the free-text `room_types.amenities[]` column (migration `0006` backfills existing values). NB Phase 2 `amenity_items` stays separate = *sellable* services.
- [x] Settings UI: `/{slug}/settings/rooms` (room types + rooms CRUD), `/{slug}/settings/rates` (rate plans, seasonal overrides, promo codes), `/{slug}/settings/amenities` (master list CRUD + hotel-wide toggle); room-type Amenities tab picks from the list with highlight flags
- [ ] Show amenities on the public hotel page + room cards (highlighted subset on the card, full list behind "See all") — do with the booking flow below
- [x] `lib/server/availability.ts` — date range + occupancy → available room types + price breakdown (reused by booking + front desk); room-count side is done, still needs to subtract overlapping bookings once `bookings`/`booking_rooms` land below
- [x] `lib/server/pricing.ts` — bill builder: nightly rates + fees + VAT (12% configurable) → total in centavos

### Guests & bookings
- [ ] Schema: `guests`, `bookings` (status: `pending_payment | confirmed | checked_in | checked_out | cancelled | no_show`), `booking_rooms`, `booking_status_history`
- [ ] Schema: `folios`, `folio_charges`, `payments`, `invoices`, `official_receipts` (per-hotel OR series counter)

### Public booking flow `/{slug}/book`
- [ ] Search (dates, guests) → results with price breakdown
- [ ] Guest details form → create `booking` (`pending_payment`)
- [ ] Review screen with full bill
- [ ] Reservation-fee / deposit option (pay part now, balance later); track `balance_due`

### PayMongo (hosted Checkout Session)
- [ ] `lib/server/paymongo/client.ts` — REST client (secret key from env)
- [ ] `lib/server/paymongo/checkout.ts` — create Checkout Session (line items = bill, success/cancel URLs)
- [ ] `lib/server/paymongo/webhook.ts` — verify `Paymongo-Signature` (HMAC-SHA256)
- [~] `routes/api/webhooks/paymongo/+server.ts` — verifies `Paymongo-Signature`, handles `checkout_session.payment.paid` (route is under `/api/` not `/webhooks/` — already registered with PayMongo, kept as-is); booking status update still TODO pending the bookings/payments schema below
- [ ] Idempotency on PayMongo event id; booking `pending_payment → confirmed`; write `payment` row
- [ ] Balance-payment link (guest) + at front desk, reusing the same checkout

### Background jobs
- [ ] Add `pg-boss`; job runner bootstrap; queues for webhooks, email, night audit
- [ ] Night audit job: post room-night charges, roll business date, flag no-shows, apply cancellation fees

### Front desk `/{slug}/front-desk`
- [ ] Bookings list + filters (arrivals, departures, in-house)
- [ ] Walk-in create
- [ ] Check-in: assign room, registration card, ID capture upload (local file store)
- [ ] Folio: auto room-night charges + incidental charges
- [ ] Check-out: settle balance (cash or PayMongo), generate invoice + OR, release room → housekeeping "dirty"

### Documents & email
- [ ] `lib/server/pdf/render.ts` (Playwright chromium.pdf) + print routes `/{slug}/print/{invoice,receipt}`
- [ ] `lib/server/email/` (nodemailer + templates): booking confirmation, payment receipt, pre-arrival

### Verify
- [ ] e2e: book on `/{slug}/book` in PayMongo test mode → webhook confirms → check-in → add charge → check-out → OR prints

---

## Phase 2 — Housekeeping + Amenities

- [ ] Schema: `room_status` (clean/dirty/inspected/out_of_order), `hk_tasks` (type, room, assignee, checklist, timestamps)
- [ ] Auto-create turnover task on checkout; OOO blocks availability
- [ ] `/{slug}/housekeeping` — board grouped by floor/status, assign to housekeeping staff, complete checklist
- [ ] Schema: `amenity_items` (name, category, price, taxable, schedulable), `amenity_bookings` (folio link or standalone + fee), optional time slots
- [ ] `/{slug}/amenities` — catalog CRUD, sell to in-house folio, standalone sale → cash-in
- [ ] Verify: checkout → dirty task → assign/complete → room available; OOO drops from availability; spa + laundry sale appear in cash-in

---

## Phase 3 — Finance: Expenses & Cashflow  *(builds `@mm/finance-core`)*

- [ ] `@mm/finance-core`: canonical `cash_movement` record, `cash_account` model, COA taxonomy + `type`/`subtype` enums, closed `category` enum; finalize `docs/standards/finance.md`
- [ ] `@mm/finance-core` unit tests (enum conformance, cash-movement schema, money math)
- [ ] App schema: `expense_categories`, `vendors`, `expenses` (input VAT, attachment, status draft/approved/paid), `recurring_expenses`
- [ ] Every expense / room payment / amenity sale / deposit writes a canonical `cash_movement` (source_app/type/ref + dimensions)
- [ ] `/{slug}/finance`: expense entry + approval workflow, cash accounts (petty cash / bank / e-wallet)
- [ ] Cashflow view: cash-in vs cash-out per account; daily cash position
- [ ] Shift / day close with expected-vs-counted reconciliation
- [ ] Daily sales report
- [ ] `@mm/integration`: `GET /api/v1/finance/accounts|cash-movements` + `cash_movement.recorded` outbox event + `outbox` table + dispatcher
- [ ] Verify: expense from petty cash → day close reconciles → cashflow shows booking payment (in) + expense (out)

---

## Phase 4 — HR & Payroll (Philippine)  *(builds `@mm/hr-core`)*

### Standard package
- [ ] `@mm/hr-core`: org model, employee master (identity + `person_ref`/`org_ref`, gov IDs, employment, pay basis, disbursement, `extensions` jsonb, `updated_at`/soft-delete), schedule model, payroll-run result model
- [ ] `@mm/hr-core/statutory`: `sss-2026`, `philhealth-2026`, `pagibig-2026`, `bir-train` — each with `effective_date`, pure function, unit tests
- [ ] `@mm/hr-core/compute.ts`: gross (basic + OT + holiday premium + night diff + allowances), less absences/tardiness, statutory deductions, BIR withholding, net; `thirteenth-month.ts`
- [ ] Finalize `docs/standards/hr.md`
- [ ] ⚠️ Verify statutory values against latest SSS circular / PhilHealth advisory / Pag-IBIG circular / BIR RMC before go-live

### Schema — group-scoped HR (centralization)
- [ ] `hotel_groups`: add `org_ref`, `legal_name`, `trade_name`, `tin`, `default_currency` (nullable, populated when a group is HR-active)
- [ ] `employees.org_ref` (resolves to `hotel_groups.org_ref` when grouped, else the standalone hotel's own `hotels.org_ref`) + `employees.primary_hotel_id` (nullable FK → `hotels.id`, home base)
- [ ] `schedules.hotel_id` (required FK → `hotels.id`, per-shift property); `dtr_entries.hotel_id` denormalized from schedule
- [ ] `group_memberships(user_id, group_id, role)` — mirrors `memberships`; reuses the existing `membership_role` enum; new `ASSIGNABLE_GROUP_ROLES` in `authz.ts` (`group_owner`, `hr`, `accountant`, `read_only` — no `front_desk`/`housekeeping` at group scope)
- [ ] `hooks.server.ts`: resolve `/group/{groupSlug}/…` — load `hotel_groups` by slug, resolve `locals.groupRole` via `group_memberships`, separately from the existing hotel-path `locals.hotel`/`locals.role`
- [ ] Admin: create/edit `hotel_groups`, assign `hotels.group_id`, set the group's org identity fields, manage `group_memberships`

### App
- [ ] Employees CRUD — hotel-scoped `/{slug}/hr` (standalone hotels, and a per-property filtered view for hotel-scoped roles) **and** group-scoped `/group/{groupSlug}/hr` (centralized HR across every hotel in the group) — same underlying employee model, both routes filter by resolved `org_ref`
- [ ] Scheduling: `shift_templates`, `schedules` (employee × date **× hotel_id**), weekly roster grid per property, holiday calendar (regular / special non-working)
- [ ] Biometric import: `parse-attlog.ts` (ZKTeco `ATTLOG.TXT`), `parse-sheet.ts` (CSV/XLS via SheetJS + column mapping)
- [ ] `pair-punches.ts`: pair in/out vs schedule → worked hours, tardiness, undertime, OT, night diff, absences → `dtr_entries` (carrying `hotel_id`); manual-correction UI with audit; unmatched enroll ids surfaced
- [ ] DTR print `/{slug}/print/dtr` (and `/group/{groupSlug}/print/dtr` for centralized HR) — per employee per cutoff, laid out against schedule; batch print; PDF
- [ ] Payroll run — hotel-scoped `/{slug}/payroll` for standalone hotels; group-scoped `/group/{groupSlug}/payroll` for grouped hotels (one run per cutoff covers every employee under the group's org): pull DTR → compute → review → lock → post to cashflow as cash-out; payroll-cost-by-property derived report groups run lines by `schedules`/`dtr_entries.hotel_id`
- [ ] Cash advances: request → approval → disbursement (cash-out) → amortization auto-deducted; per-employee CA ledger
- [ ] Payslips `/{slug}/print/payslip` (and group equivalent) — per employee per run; PDF + optional email
- [ ] Payroll register export (CSV/Excel); remittance summaries (SSS R-3-style, PhilHealth, Pag-IBIG, BIR 1601-C figures)
- [ ] `@mm/integration`: `GET /api/v1/hr/orgs|employees|schedules|payroll-runs` (cursor + `updated_since`) + `employee.updated` / `payroll_run.posted` events
- [ ] Verify: create a `hotel_group` with 2 hotels + an HR-role `group_membership` → add an employee with `primary_hotel_id` = hotel A → schedule shifts at both hotel A and hotel B → upload sample `ATTLOG.TXT` → DTR correct per hotel → run one group-wide payroll → payroll-cost-by-property report splits correctly between A and B → deductions match an independent 2026 calculator (±₱1) → payslip PDF → net pay as cash-out → `GET /api/v1/hr/employees` returns standard shape with `person_ref`

---

## Phase 5 — Accounting & Reports  *(builds `@mm/finance-core` posting + reports)*

- [ ] `@mm/finance-core`: `journal_entries` + `journal_lines` model (double-entry, always balanced, immutable), COA seed sets, `PostingRule` interface, report builders parameterized by `hotelIds: string[]` + dimension filters
- [ ] COA per hotel (seeded); lines tagged with dimensions (`org_ref`, `hotel_id`, `department`, `cost_center`)
- [ ] Auto-posting rules (activate the stubs from Phases 1/3/4): room payment, deposit, refund, amenity sale, expense, payroll run, cash movement, VAT — each emits `journal_entry.posted`
- [ ] Reports `/{slug}/reports` (CSV/PDF/Excel):
  - [ ] Accounting ledger report (account activity + running balance, drill to source) — the explicitly requested one
  - [ ] Trial balance, income statement, balance sheet
  - [ ] Occupancy %, ADR, RevPAR, revenue by room type / booking source, cancellations/no-shows
  - [ ] Output VAT, input VAT, withholding summary
- [ ] `@mm/integration`: `GET /api/v1/finance/journal-entries` + `GET /api/v1/finance/reports/ledger|trial-balance|income-statement`
- [ ] Dashboard widgets: arrivals/departures, occupancy, cash position, revenue MTD
- [ ] Verify: ledger report shows lines from a booking payment + an expense + a payroll run; trial balance balances

---

## Phase 6 — Group / owner consolidation

Group access plumbing (`hotel_groups` org fields, `group_memberships`,
`/group/{groupSlug}/…` resolution in `hooks.server.ts`) is now built in
**Phase 4**, since centralized HR needs it first. Phase 6 is a pure consumer
of that existing area — it does not re-build routing or membership, it adds
finance/report routes onto it.

- [ ] `ROLE_CAPS`/`ASSIGNABLE_GROUP_ROLES`: confirm `group_owner` (`*:read`, `reports:*`) and `accountant` (group-scoped `finance:*`/`reports:*`) cover the report surface below; no new roles
- [ ] `/group/{groupSlug}/…` area (already routed/authorized from Phase 4)
  - [ ] Portfolio dashboard: occupancy / ADR / RevPAR / revenue / cash position per hotel + rolled up
  - [ ] Consolidated income statement / balance sheet / trial balance (per-hotel columns + eliminations column)
  - [ ] Consolidated accounting ledger report (filter by hotel or all)
  - [ ] Cross-hotel comparisons, payroll cost by property (reuses the derived report from Phase 4), expense benchmarking
- [ ] Consolidated views call the same `@mm/finance-core` report builders with all group `hotelIds`
- [ ] Verify: add `hotel2`, post activity in both, group ledger + trial balance == sum of per-hotel reports

---

## Cross-cutting (ongoing, not a phase)

- [ ] Audit log on every mutation (extend `writeAudit` coverage as modules land)
- [~] Promo codes / discounts, seasonal rates, length-of-stay rules — schema + settings UI done (room-type code/category/gallery, room connecting/active flags + maintenance status, rate-plan weekend pricing, child/extra-bed fees, free-child age, inclusions, plan min/max stay, `seasonal_rates` date ranges w/ multiplier); still to do: enforce min-stay from `daily_rates`/`seasonal_rates` rows, promo-code redemption flow, occupancy-based dynamic pricing
- [ ] Guest feedback capture post-checkout
- [ ] Backups: documented `pg_dump` cron + restore runbook
- [ ] Roles & permissions matrix documented in `$lib/authz.ts`
- [ ] Accessibility & responsive: staff app usable on a front-desk tablet; booking flow mobile-first
- [ ] `@mm/integration` payload conformance tests against `docs/standards` schemas
- [ ] Migrate `zod` v4 deprecations (`z.string().email()` → `z.email()`, `.uuid()` → `z.uuid()`)
