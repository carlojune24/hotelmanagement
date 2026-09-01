# MM Hotel — build checklist

Living task list. Mirrors the plan (`~/.claude/plans/lets-plan-this-out-logical-dragonfly.md`).
Check items off as they land. `[~]` = partially done / stubbed.

---

## Phase 0 — Foundation ✅ (done, verified end-to-end 2026-08-31)

- [x] pnpm monorepo: `apps/hotel` + `packages/{hr-core,finance-core,integration}`
- [x] `docs/standards/{hr,finance}.md` first drafts + `@mm/integration` primitives & events
- [x] Drizzle + local Postgres wiring, `docker-compose.yml` (optional), `.env.example`
- [x] Schema: `hotels`, `hotel_groups`, `users`, `memberships`, `sessions`, `invites`, `audit_log`
- [x] Auth: Argon2id passwords, opaque cookie sessions, login / logout / accept-invite
- [x] Tenant resolution + guards in `hooks.server.ts`; reserved prefixes; `scopedDb` helper
- [x] Platform admin: hotels list + create, config wizard, publish/archive, members (invite/role/remove), users (invite platform admin, enable/disable), audit-log rows
- [x] Staff app shell for `/{slug}` with role-aware nav; empty dashboard
- [x] `seed.ts` (platform admin, demo hotel `hotel1`, hotel manager)
- [x] Unit tests (slug rules, RBAC, standard primitives) + typecheck green

### Phase 0 loose ends (do before/with Phase 1)
- [ ] `git init` + initial commit + push to a remote
- [ ] Password reset flow (request + token email + set new password) — currently only login/invite
- [ ] `scopedDb(hotelId)` actually enforced (helper exists; wire a lint rule / query wrapper)
- [ ] Rate-limit login + invite-accept (basic in-memory or `pg-boss`-backed)
- [ ] Global error page (`src/routes/+error.svelte`) + `handleError` hook
- [ ] CI: run `pnpm check` + `pnpm test` on push
- [ ] Playwright harness + first e2e (login → admin → create hotel)

---

## Phase 1 — Core PMS + Online Booking + PayMongo (MVP)

### UI foundation (do first)
- [ ] `pnpm dlx shadcn-svelte@latest init` in `apps/hotel`; wire its CSS variables to the existing `src/app.css` theme tokens (surface/ink/border/brand/danger/ok, light + dark)
- [ ] Add the primitives Phase 1 needs: button, input, select, label, dialog, dropdown-menu, popover, calendar/date-picker, table, badge, sonner (toast), form
- [ ] Migrate current `$lib/components/ui.ts` recipes + existing admin/auth screens to shadcn components; delete `ui.ts` once nothing imports it
- [ ] Toast on every form action result (replace inline `form?.ok` / `form?.error` banners)

### Inventory & rates
- [ ] Schema: `room_types`, `rooms`, `rate_plans`, `daily_rates`, `taxes_fees` (reservation fee, resort fee, VAT), `cancellation_policies`
- [ ] Settings UI: `/{slug}/settings/rooms` (room types + rooms CRUD), `/{slug}/settings/rates` (rate plans, seasonal overrides, promo codes)
- [ ] `lib/server/availability.ts` — date range + occupancy → available room types + price breakdown (reused by booking + front desk)
- [ ] `lib/server/pricing.ts` — bill builder: nightly rates + fees + VAT (12% configurable) → total in centavos

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
- [ ] `routes/webhooks/paymongo/+server.ts` — receive → enqueue → worker handles `checkout_session.payment.paid`
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

### App
- [ ] Employees CRUD `/{slug}/hr` (profile, employment, pay setup, gov IDs, `biometric_enroll_id`, disbursement)
- [ ] Scheduling: `shift_templates`, `schedules` (employee × date), weekly roster grid, holiday calendar (regular / special non-working)
- [ ] Biometric import: `parse-attlog.ts` (ZKTeco `ATTLOG.TXT`), `parse-sheet.ts` (CSV/XLS via SheetJS + column mapping)
- [ ] `pair-punches.ts`: pair in/out vs schedule → worked hours, tardiness, undertime, OT, night diff, absences → `dtr_entries`; manual-correction UI with audit; unmatched enroll ids surfaced
- [ ] DTR print `/{slug}/print/dtr` — per employee per cutoff, laid out against schedule; batch print; PDF
- [ ] Payroll run `/{slug}/payroll` — per cutoff (semi-monthly default, configurable): pull DTR → compute → review → lock → post to cashflow as cash-out
- [ ] Cash advances: request → approval → disbursement (cash-out) → amortization auto-deducted; per-employee CA ledger
- [ ] Payslips `/{slug}/print/payslip` — per employee per run; PDF + optional email
- [ ] Payroll register export (CSV/Excel); remittance summaries (SSS R-3-style, PhilHealth, Pag-IBIG, BIR 1601-C figures)
- [ ] `@mm/integration`: `GET /api/v1/hr/orgs|employees|schedules|payroll-runs` (cursor + `updated_since`) + `employee.updated` / `payroll_run.posted` events
- [ ] Verify: employee + schedule → upload sample `ATTLOG.TXT` → DTR correct → run payroll → deductions match an independent 2026 calculator (±₱1) → payslip PDF → net pay as cash-out → `GET /api/v1/hr/employees` returns standard shape with `person_ref`

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

- [ ] Schema: use existing `hotel_groups`; wire `hotels.group_id`; role `group_owner` grants read across the group
- [ ] `/group/{groupSlug}/…` area (reserved prefix already set)
  - [ ] Portfolio dashboard: occupancy / ADR / RevPAR / revenue / cash position per hotel + rolled up
  - [ ] Consolidated income statement / balance sheet / trial balance (per-hotel columns + eliminations column)
  - [ ] Consolidated accounting ledger report (filter by hotel or all)
  - [ ] Cross-hotel comparisons, payroll cost by property, expense benchmarking
- [ ] Consolidated views call the same `@mm/finance-core` report builders with all group `hotelIds`
- [ ] Verify: add `hotel2`, post activity in both, group ledger + trial balance == sum of per-hotel reports

---

## Cross-cutting (ongoing, not a phase)

- [ ] Audit log on every mutation (extend `writeAudit` coverage as modules land)
- [ ] Promo codes / discounts, seasonal rates, length-of-stay rules (schema in Phase 1, UI polish later)
- [ ] Guest feedback capture post-checkout
- [ ] Backups: documented `pg_dump` cron + restore runbook
- [ ] Roles & permissions matrix documented in `$lib/authz.ts`
- [ ] Accessibility & responsive: staff app usable on a front-desk tablet; booking flow mobile-first
- [ ] `@mm/integration` payload conformance tests against `docs/standards` schemas
- [ ] Migrate `zod` v4 deprecations (`z.string().email()` → `z.email()`, `.uuid()` → `z.uuid()`)
