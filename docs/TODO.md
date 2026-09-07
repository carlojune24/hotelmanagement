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
- [x] Custom domain mapping (production prep) — a client can point their own domain at the platform: `hotels.customDomain` (bare hostname, unique, nullable) + a new `reroute` hook in `hooks.server.ts` rewrites e.g. `mmhotel.com/book` to `/mmhotel/book` internally (invisible to the browser), with a 60s in-memory hostname→slug cache so a newly-set domain takes effect without a restart. Tenant resolution itself had to move from parsing `event.url.pathname` (which `reroute` does **not** update — verified directly against the installed SvelteKit's own source, not assumed) to reading `event.params.hotel` instead, which SvelteKit populates from the rewritten path before `handle` runs; this also made the old manual `RESERVED_PREFIXES` gate redundant as the primary check (kept as defense-in-depth) since non-`[hotel]` routes never populate that param at all. `reroute` itself skips rewriting a reserved top-level path (`/api`, `/admin`, `/_app/...` static assets, etc.) or a path that's already correctly slug-prefixed, so it can't double-prefix or break asset loading. Set from `/admin/hotels/[hotelId]`'s Configuration panel only (platform-admin, no self-service, no DNS-ownership verification — manual trust, same posture as the other identity fields there). **Not built**: actually pointing a domain's DNS/TLS at this app's host is an external, per-client operational step this app cannot do for you; and the app's own internal links are still hardcoded with the slug (`const base = \`/${page.params.hotel}\`` throughout), so navigating inside the app from a custom domain will pick up the slug in the URL again after the first click — full URL-consistency across in-app navigation is a follow-up, not this pass
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
- [x] Show amenities on the public hotel page + room cards — hotel-wide amenities grouped by category in the storefront's About section, up to 3 highlighted amenities (+ bed config, + accessibility mark) as a room-at-a-glance line on every room row
- [x] `lib/server/availability.ts` — date range + occupancy → available room types + price breakdown (reused by booking + front desk), subtracting rooms already held by an active (`pending_payment`/`confirmed`/…) booking for any overlapping night
- [x] `lib/server/pricing.ts` — bill builder: nightly rates + fees + VAT (12% configurable) → total in centavos

### Guests & bookings
- [x] Schema: `guests`, `orders` (the actual checkout object — `pending_payment | confirmed | cancelled`, one PayMongo session, one guest, one bill), `bookings` (room stays; status `pending_payment | confirmed | checked_in | checked_out | cancelled | no_show`), `booking_rooms`, `booking_status_history`, `order_status_history` — `access_token` guard lives on `orders` now (moved up from `bookings`, since one token covers every line under an order), checked on every guest-facing URL; bill amounts snapshotted at creation, never recomputed live
- [x] Schema: `payments` (idempotent on `paymongo_event_id`, keyed to `orders.id`) — `folios`/`folio_charges` now built (see Front desk below); `invoices`/`official_receipts` (per-hotel OR series counter) still TODO

### Public booking flow `/{slug}/book` — Woven Ledger world (see apps/hotel/DESIGN.md)
- [x] Search (dates, guests) → results with price breakdown (ruled-row room types, expandable rate plans)
- [x] Floating invoice/cart (`lib/cart.svelte.ts`, Svelte-context + sessionStorage) — a guest adds one or more room stays and/or function hall reservations before checking out once
- [x] Guest details form → `createOrder` action: re-verifies availability + re-prices every cart line server-side (sorted per-product advisory locks), creates one `orders` row with a `bookings`/`hallBookings` row per line
- [x] Review screen with the full itemized bill (every line, fees, VAT, total) — `checkout.ts` builds one PayMongo line item per cart line
- [x] Confirmation screen (the ticket component, itemized) with a race-safe "confirming payment" polling state; webhook fans one paid session out to confirm every `bookings`/`hallBookings` row under the order
- [ ] Reservation-fee / deposit option (pay part now, balance later); track `balance_due` — not built, full-payment-only for now
- [ ] Multiple rooms *of the same type* in one line (`booking_rooms.quantity` still only ever inserted as `1`) — distinct from the floating invoice above, which already lets an order carry several different lines (different room types/dates, and/or a function hall)

### Function hall
- [x] Schema: `function_halls` (per-hotel, hourly product: capacity, `baseHours` + `basePriceCentavos`, `extraHourFeeCentavos`, `includedServices`/`supportedEventTypes` as hotel-authored free text), `hall_bookings` + `hall_booking_status_history` (an order line, same lifecycle shape as `bookings`)
- [x] `lib/server/pricing.ts`'s `priceEventHall` (base block + extra-hour rate, reuses the same fee/VAT pass as `priceStay` via the extracted `computeFeesAndVat`) and `lib/server/hall-availability.ts` (undated browse listing + per-slot overlap check)
- [x] Settings UI: `/{slug}/settings/function-halls` (list + full edit — photos, included services/event types, pricing)
- [x] Storefront `#function-hall` section — hall details + a reservation mini-form with a live server-computed quote (`/book/api/hall-quote`) before "Add to invoice"

### Reviews
- [x] Schema: `reviews` (one per `bookingId`, `pending | approved | rejected`, `rating` 1–5 with a DB check constraint) — real, never fabricated; gated on the parent booking actually reaching `checked_out`
- [x] Guest submission: `/{slug}/book/leave-review/[bookingId]` (guarded by the parent order's `access_token`), linked from the confirmation page once a room stay is `checked_out`
- [x] Staff moderation: `/{slug}/reviews` (Pending/Approved/Rejected tabs, approve/reject)
- [x] Public display: storefront `#reviews` section, approved reviews only, no aggregate score computed
- [ ] No email delivery exists anywhere in this codebase yet to proactively send the review link post-stay — the confirmation-page CTA is the only discovery path today

### Per-hotel branding
- [x] `hotels.config.branding` (logo, accent color, hero image, tagline, `about`, `galleryImages`) + `/{slug}/settings/branding` admin UI — logo/hero/gallery upload to local disk (`lib/server/uploads.ts`), not just pasted URLs

### PayMongo (hosted Checkout Session)
- [x] `lib/server/paymongo/client.ts` — REST client (secret key from env)
- [x] `lib/server/paymongo/checkout.ts` — create Checkout Session (line items = bill, success/cancel URLs)
- [x] `routes/api/webhooks/paymongo/+server.ts` — verifies `Paymongo-Signature`, handles `checkout_session.payment.paid`: idempotent on the webhook event id, flips `pending_payment → confirmed` only (never clobbers a further-advanced status), writes a `payments` row + `booking_status_history` row
- [ ] Balance-payment link (guest) + at front desk, reusing the same checkout — depends on the deposit/balance_due bullet above

### Background jobs
- [ ] Add `pg-boss`; job runner bootstrap; queues for webhooks, email, night audit
- [ ] Night audit job: post room-night charges, roll business date, flag no-shows, apply cancellation fees

### Front desk `/{slug}/front-desk`
- [x] Bookings list + filters (arrivals, departures, in-house) — `/{slug}/front-desk` is now a room-status grid (`getRoomStatusGrid`, business-date resolved via the hotel's own timezone): every physical room as one cell (vacant/occupied/departing-today/reserved/out-of-order), grouped by floor, with a room-type filter + guest/room search. Clicking a room shows its booking (guest, dates, occupancy, rate plan, total, payment channel — online vs. walk-in, derived from `payments.provider` — special requests) in a side rail; the rail defaults to flat Arrivals/Departures tabs when no room is selected. A "reserved" flag can only ever point at a room *type* (every unassigned confirmed arrival of that type today), never a specific room — `room_assignments` rows don't exist until check-in. `/{slug}/reservations` remains the separate all-time/filterable verification list
- [x] Walk-in create — folded into `/{slug}/front-desk` itself as a slide-in drawer (no more separate `/front-desk/walk-in` route): staff pick an available room type/rate for chosen dates (`?/walkInSearch` action, reusing `searchAvailability`), `createWalkInBooking` creates guest+order+booking as `confirmed` with a `cash` payment row (settled on the spot, no PayMongo session — `?/walkInCreate` action), then hands off to the existing reservation-detail check-in UI. Clicking "Walk-in this room type" on a vacant room's grid cell opens the same drawer pre-selecting that type
- [x] Check-in: assign room — already existed (`checkInBooking`), now also linked from the grid's arrivals rail. Registration card / ID capture upload still not built
- [x] Check-in/check-out time policy + extension fees — own settings page now, `/{slug}/settings/check-in-out` (moved off `/settings/branding`, which keeps only the guest-facing `checkInPolicy`/`checkOutPolicy` free text): `hotels.checkInTime`/`checkOutTime` (default 14:00/12:00) plus per-hour `lateCheckoutFeePerHourCentavos`/`earlyCheckInFeePerHourCentavos` (default 0 — a rate, not a total; front desk judges the hours and multiplies, nothing tracks actual arrival/departure time). Surfaced on the front desk's room panel — the times on arrivals/departures badges, the fees as a reference note ("Late checkout fee: ₱X/hour — quote for however many hours and collect in person") on a departing room or a reserved room's arrivals. Reference only, by design: no folio/charge record is created, nothing is added to `bookings.totalCentavos` — actually billing this needs the folio system below. There's still no "extend stay" flow (adding a night to an existing booking): `bookings.checkIn`/`checkOut` remain fixed at creation with no update path once a guest wants to push their checkout date out
- [x] Function halls — a "Function halls" board below the room grid (`getHallStatusBoard`): every active hall with today's paid (`confirmed`/`completed`) events (guest, event type, time, guest count, payment channel, total). "Walk-in event" opens a per-hall drawer (`createWalkInHallBooking` — same cash-settled-on-the-spot posture as room walk-ins) that shows a live rate breakdown as front desk adjusts date/time (base price for the hall's included hours, extra-hour rate × however many hours over, fees, VAT, total) before they commit. Its own quote endpoint, `/{slug}/front-desk/api/hall-quote` (distinct from the guest-facing `/book/api/hall-quote`, which only prices — a conflict there is only ever caught at order-creation time, after the guest's already gone through checkout), checks `checkHallAvailability` *before* pricing, so front desk sees "already booked for that time" immediately while adjusting the slot rather than only on submit; `createWalkInHallBooking` still re-checks at creation time regardless, inside the same advisory-locked transaction, so a real double-booking can't be persisted even if two front-desk sessions race each other. A confirmed event gets a "Mark completed" action (`completeHallBooking`) — the closest hall equivalent to a room's check-out, staff's own judgment call on timing since nothing tracks the event's real end time
- [x] Folio: auto room-night charges + incidental charges — `lib/server/folio.ts` + schema (`folios`, `folio_charges`, and `amenity_items` pulled forward from Phase 2 as the priced catalog charges are sold from). `getOrCreateFolio`/`getFolioDetail` creates one per booking on first touch, seeded with a single line equal to the booking's own already-priced total — that line's matching payment already exists (the original booking payment), so the folio starts exactly balanced and only owes anything once a new charge is added without a matching new payment. Front desk adds charges from the catalog (`addAmenityItemCharge`, quantity × the item's price, VAT applied per the item's own `taxable` flag) or one-click from the per-hour extension-fee rates (`addExtensionFeeCharge`, hours × the configured rate, non-taxable) — both surfaced in the "Full details" dialog's new Folio section, replacing the old plain "Bill" breakdown. `settleFolioBalance` pays off the balance in cash (a `payments` row against the booking's order — same table/mechanism walk-ins already use); check-out (`checkOutBooking`) now refuses to proceed while `balanceCentavos > 0`, closing the folio on success. Settings CRUD at `/{slug}/settings/amenity-items` ("Sellable items" — name, category, price, taxable, active, sort order; delete blocked once an item's actually been charged to a guest, deactivate instead). **Folios are polymorphic** — `folios.bookingId`/`hallBookingId` are both nullable with a `folios_exactly_one_target` check constraint, since a folio can belong to either a room booking or a function hall booking (the initial pass only wired up rooms; a function hall's board had no "open this booking" affordance at all, so its charges were unreachable — fixed by giving `lib/server/folio.ts`'s functions a `FolioTarget` discriminated union and adding a matching "Full details" dialog + `?/hallDetail`/`?/addHallItemCharge`/`?/settleHallFolio` actions to the Function Halls board, reusing `getHallBookingDetail` the same way the room dialog reuses `getRoomBookingDetail`). Extension fees (`addExtensionFeeCharge`) stay room-only, a hall reservation has no check-in/check-out clock to extend. A hall booking's folio has no check-out-style balance gate — `completeHallBooking` ("Mark completed") doesn't block on it, unlike `checkOutBooking` for rooms. A charge can now be voided (`voidFolioCharge` — `?/voidCharge`/`?/voidHallCharge`), soft-deleted (`voidedAt`/`voidedByUserId`/`voidReason`, excluded from the balance calc but still shown struck-through on the folio for audit purposes) rather than hard-deleted; the seeded base stay charge (`isBaseCharge`) can never be voided. Still no invoice/OR document generation — that's a separate, still-open item below
- [~] Check-out — `checkOutBooking` flips a checked-in booking to `checked_out`, from either the departures list or straight off an "Occupied" room ("Check out early" — takes a `businessDate` param now, and when it's before the booking's original `checkOut`, also caps the room's `room_assignments.checkOut` at today; otherwise a checked-out-but-still-in-its-original-date-range assignment would keep blocking that physical room from any new booking for the nights the guest gave up, even though the front-desk grid already shows it vacant). Now actually blocks on an unsettled folio balance (see the folio bullet above) — a fresh booking with no incidental charges still checks out freely, since its seeded folio line nets to zero against its original payment; no proration/refund for an early checkout's unused nights either. Invoice/OR generation and "release room → housekeeping dirty" still TODO (need `invoices`/`official_receipts` schema + PDF rendering, and a housekeeping-status column on `rooms` — none of which exist yet)

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
- [x] Schema: `amenity_items` (name, category, price, taxable) — pulled forward into Phase 1's folio work (`docs/TODO.md`'s Front desk section) since the folio needed a real catalog to sell from; no `schedulable`/time-slot concept or standalone (non-folio) sale built — every item sale today goes through a booking's folio, front desk only, at `/{slug}/settings/amenity-items` ("Sellable items") + the folio UI in `/{slug}/front-desk`'s room detail dialog. `amenity_bookings` as its own table was skipped — a sale is just a `folio_charges` row referencing the `amenityItemId`
- [ ] Standalone (non-guest, walk-up) amenity/service sale → cash-in, with no booking/folio behind it — not built; today's `amenity_items` can only be sold onto an existing booking's folio
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
