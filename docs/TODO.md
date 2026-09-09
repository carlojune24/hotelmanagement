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

### Client flow reconciliation (added 2026-09-08, from `docs/mmhotel_flow.png`)

The client's flow diagram maps almost 1:1 onto what's built. Boxes already
covered: search / availability / cart / guest-info capture, PayMongo hosted
payment + response polling, room & rate management, room assignment at
check-in, check-out, folio + incidental charges, payment history, Finance
reports, cash / day-close, per-hotel data isolation. The gaps below are what
the diagram expects and we don't have yet.

- **Terminology:** the diagram's "MONGOPAY Payment Gateway" = **PayMongo** (client shorthand). No processor change — the built hosted-Checkout-Session + webhook integration is correct. Noted here so the mismatch isn't re-raised.
- [ ] **Guest confirmation email** — diagram's "Booking Confirmation (email/SMS)". Email only for MVP (see the "Documents & email" bullet below); **SMS is post-MVP** (needs a PH provider — Semaphore / Movider / Twilio — decision deferred, still out of MVP scope per the plan).
- [ ] **Accountable-forms module** (was "Guest-facing receipt / invoice"; scope grew during the 2026-09-08 design pass — direction contract in `apps/hotel/.impeccable/surfaces/src-routes-hotel-print.md`). Diagram's "Payment Receipt / Invoice". Today `/{slug}/print/receipt/[paymentId]` is a thermal-style HTML route that disclaims BIR. Replacing it with a real Philippine accountable-forms module:
  - **Documents** — an **Invoice** (itemized: charges, fees, VATable/exempt/zero-rated split, 12% VAT, total, less payments, balance due; issued at check-out, also for prepaid online bookings) and a separate **Official Receipt** (proof of one payment: amount, method, ref, tendered/change, "applied to Invoice No."; refunds render as `OFFICIAL RECEIPT (REFUND)`). One shared **"Accountable Form"** print template (ink-on-white, double-ruled frame, brick-red serial, Inter + JetBrains Mono, no woven pattern / accent fills), rendered byte-identical for guest (order `access_token`) and staff (`folio:read`), and to PDF via Playwright `chromium.pdf` (≤~120 KB, fonts subset-embedded, zero external requests).
  - **Serial numbers from BIR-registered series, not a perpetual counter** — `document_series` table: each row is one ATP/CAS-authorized batch (`type`, `prefix`, `serialFrom`/`serialTo`, permit no., accredited printer + accreditation no., `status` active/exhausted/superseded/cancelled). Allocation draws the next `unused` serial from the **active** series only; numbers never cross series; a new ATP = a new series (possibly new prefix/start). Serial assigned inside the finalizing tx (check-out for Invoice, `recordPayment`/`recordWalkInPayment`/webhook for OR) — no gaps from a failed render. Reprints deterministic, same number, grey `REPRINT` tag.
  - **Per-serial liquidation** — every serial is `unused | issued | cancelled | spoiled`. `documents` row per issued number (assigned no. + totals snapshot). `cancelDocument` (reason, number stays dead, optional replacement chain) + `spoilSerial` (print failure, number consumed, no tx). OR-liquidation register report: full range with per-serial status/reason/preparer + drill to source.
  - **X-reading / Z-reading** — Z-reading tied to `runDayClose` (`z_readings` table: Z-counter, business date, beginning/ending doc numbers, gross/net sales, VAT split, SC/PWD discounts, voids/cancellations, refunds, accumulated grand total old→new, tender breakdown; locked by day close, `hotel_admin` reopen re-issues). X-reading = same shape, on demand, no reset, no counter increment. Both as reports + Accountable Form printouts.
  - **`/{slug}/finance/bir` menu** (new finance-nav section, not `/{slug}/settings`) — tabs: **Setup** (hotel TIN, VAT-registered toggle, accredited printer, prefix/pad defaults, auto-assign-invoice-at-checkout toggle), **Series** (register/manage `document_series`), **Accountable forms** (liquidation register + cancel/spoil), **Readings** (X on demand, Z list). Admin screens inherit the existing staff shadcn/oklch shell — only the printed documents are the new visual world.
  - **Config-driven compliance** — full statutory footer (permit no., printer accreditation, inclusive range, VAT vs non-VAT phrase, 5-year validity, amount-in-words) when the hotel's BIR data is set; a single "computer-generated, not BIR-registered" line until then.
  - Supersedes the scattered invoice/OR bullets under "Guests & bookings", "Documents & email", and the Check-out bullet. **Build order:** (1) series + issuance core + template + Invoice/OR routes, (2) liquidation, (3) X/Z readings, (4) confirmation-email PDF attachment.
  - [x] **Step 1 landed (2026-09-08)** — `schema/documents.ts` (`bir_settings`, `document_series`, `documents` + enums; migration `0021`). `lib/server/finance/documents.ts`: `allocateSerial` (row-locked, gapless, flips series to `exhausted`), `issueInvoice` / `issueOfficialReceipt` (idempotent, snapshot frozen at issue), `buildInvoiceSnapshot` (VATable/exempt split recovered from the booking/hall breakdown for the base charge), `amountInWords`, series + settings CRUD. Shared **Accountable Form** print component (`lib/components/print/accountable-form.svelte`) — ink-on-white, double-rule frame, brick-red serial, Inter + JetBrains Mono. Routes `/{slug}/print/{invoice,receipt}/[documentId]` (staff `folio:read` or guest `?t=<order token>`; the receipt route also accepts a raw `paymentId` for staff, replacing the old `/print/receipt/[paymentId]` thermal route). `/{slug}/finance/bir` section (Setup / Series / Documents tabs). Eager non-fatal issuance wired into `checkOutBooking` (invoice) and `recordPayment` (OR), gated on the `autoIssue*` toggles; lazy issue-on-first-print as fallback. `seedFinanceDefaults` seeds a `bir_settings` row. Unit tests for `formatSerial` / `amountInWords`. Serials render grouped (`INV-000001` / `OR-000001`); documents carry an `ORIGINAL` / `REPRINT` copy tag; print CSS has `@page { size: A4; margin: 10mm }`, a print-mode `.af-frame` min-height so the ruled filler fills the sheet on paper, and `break-inside: avoid` guards on the totals/words/signature/footer/row blocks. **Impeccable finish review: `ship`** (build faithful to the direction contract — brick red confined to doc-type word + serial, ink-on-white, two-register type, double-rule frame; 5 material fixes applied + scored resolved). DESIGN.md "Accountable Forms" world documented alongside the existing Woven Ledger world. **Not yet:** server-side PDF render (`lib/server/pdf/render.ts` — browser Ctrl+P / Save-as-PDF works now; the `@page` margins and `preferCSSPageSize` must be honored when the Playwright `pdf()` path is built), per-hotel accent in the letterhead rule, page-2 continuation for a very long folio, an "issue now" button in front-desk (eager hook + lazy print cover it). Dev helpers: `scripts/seed-bir-sample.ts` / `scripts/reset-bir-sample.ts`.
  - [x] **Step 2 landed — liquidation (2026-09-08)** — `cancelDocument` (issued → `cancelled`, dead number kept with its snapshot, optional `issueReplacement` that issues a fresh serial and links `replaces`/`replacedBy`; document-only — the payment/folio is not touched) and `spoilSerial` (consumes the next serial in the active range as a `status='spoiled'` `documents` row with `snapshot={}`, no transaction). `assembleLiquidationRows` (pure, unit-tested — one row per consumed serial, consecutive `unused` collapse into a single range row) + `getLiquidationRegister` (series + per-serial status/reason/preparer + summary counts). New **Accountable forms** tab in `/{slug}/finance/bir` (series picker, summary tiles, register table, "Spoil next serial"); **Cancel** action per issued row on the Documents tab (reason + "issue replacement" checkbox). Printable register at `/{slug}/print/liquidation/[seriesId]` (`lib/components/print/liquidation-register.svelte` — same ink-on-white / double-rule / mono idiom as the Accountable Form, no new colour). Print routes reject a `spoiled` document (404) and render a `cancelled` one with a `CANCELLED` tag (ink, not red — stays within the one-red rule). Cancel/spoil gated on `finance:write` (accountant + hotel_admin). **Also (per user note this session):** `issueOfficialReceipt` no longer auto-issues an Invoice — it only *references* one that already exists, so a payment (deposit, partial, pre-checkout stay) is always receiptable on its own; issuing an Invoice stays a deliberate act (check-out or explicit). 14 `documents.test.ts` cases.
  - [x] **Step 3 landed — X/Z readings (2026-09-08)** — migration `0022` adds `z_readings` (per-hotel monotonic `z_counter`, business date, serial spans, sales / VAT split / discounts / voids / refunds / net, running `prev_grand_total` → `new_grand_total`, `tender_breakdown` jsonb). `lib/server/finance/readings.ts`: `computeReadingData` (shared X/Z math — cash-basis on `daySnapshot`'s `cash_movements` gross; VAT extracted VAT-inclusive from `hotels.vat_rate_bps` when `bir_settings.is_vat_registered`; serial spans from that day's issued docs; tender breakdown + void/refund counts from `payments`); `getXReading` (interim, nothing written, projected grand total); `issueZReading` (next counter, `prev` = latest Z's `new_grand_total`, inserts the row); `getZReadingView` / `listZReadings`. **Wired into `runDayClose`** via a deferred `import()` (breaks the `dayclose`↔`readings` cycle) — non-fatal, so a Z-post failure never blocks the close; re-closing a reopened day issues a fresh Z (BIR keeps every one). **Readings** tab in `/{slug}/finance/bir` (today's X summary + date picker + "Print X-reading"; Z-readings table with print links; a "Generate Z for a closed day" fallback gated on `dayclose:run`). Print routes `/{slug}/print/reading/x?date=` and `/{slug}/print/reading/z/[zReadingId]` render `lib/components/print/reading-slip.svelte` (same Accountable Form idiom — `X-READING` / `Z-READING No. N` in brick red; X says "Projected grand total", Z says "New grand total"; X carries an interim disclaimer). Verified end-to-end: day-close on 2026-09-08 auto-issued Z No. 1; an X on 2026-09-07 (₱501 gross) split 447.32 vatable + 53.68 VAT correctly. `scripts/seed-bir-sample.ts` now also sets `hotels.vat_rate_bps` to 1200 when it's 0 (the demo hotel shipped with 0); `reset-bir-sample.ts` clears `z_readings` too.
- [ ] **Guest self-service manage-booking** — diagram implies the guest can reach their booking (the admin box says "modify or cancel"; guests need at least lookup + cancel). Build `/{slug}/book/manage` (lookup by reference + email/last name, or reuse the order `access_token`): view status, re-download receipt, request/perform a cancellation within the rate plan's `cancellation_policies` terms. Currently only `book/review/[orderId]?t=…` exists and it only retries payment.
- [ ] **Staff cancel booking / order** — diagram's admin "Booking Details … modify or cancel". `bookings.status`/`orders.status` already have `cancelled`; there is **no transition path**. Add a cancel action (front-desk room panel + `/{slug}/reservations`): release the room / hall slot, compute a cancellation fee vs. refund from `cancellation_policies`, write status-history rows, and (if paid) route the refund through `refundPayment` / a PayMongo refund.
- [ ] **Staff mark no-show** — `no_show` enum value exists, no action. Add a manual "mark no-show" on an arrival past its check-in date (front desk), plus the auto-flag in the night-audit job (see "Background jobs"). Applies any no-show fee per policy.
- [ ] **Modify booking / extend stay** — `bookings.checkIn`/`checkOut` are fixed at creation with no update path; no change-room-type or change-guest-count either. Add an edit flow: re-check availability + re-price the affected nights, adjust the folio (extra night as a folio charge or a re-priced base line), write status-history. This is the "modify" half of the admin "Booking Details" box.
- [ ] **Basic staff dashboard** — diagram's "Reports / Dashboard" on the admin side; `/{slug}/dashboard` is currently an empty stub. MVP cut: arrivals / departures / in-house counts today, occupancy count (rooms occupied / total), cash position, revenue MTD. **Full occupancy % / ADR / RevPAR analytics stay Phase 5**; **full guest directory / CRM stays Phase 2** (both confirmed with the client as post-MVP — the diagram's "Guest Details … manage" and "occupancy" are acknowledged as later phases, not MVP).
- [ ] **Payment failure / expiry handling** — diagram's gateway "Payment Response: Success / Failed / Pending". The webhook only handles `checkout_session.payment.paid`; `checkout_session.payment.failed` and expired/abandoned sessions are ignored, so `pending_payment` orders hold their rooms forever. Add: handle the failed event, and a sweep (night-audit job or a TTL on `orders.createdAt`) that expires abandoned `pending_payment` orders and releases the held inventory.
- [ ] **In-hotel audit-log viewer** — diagram's "Security & Audit Logs" is a first-class box. `audit_log` + `writeAudit` exist but coverage is partial and the only viewer is platform `/admin`. Add `/{slug}/settings/audit` (hotel-admin) and widen `writeAudit` to booking / folio / payment / finance mutations (overlaps the cross-cutting "Audit log on every mutation" item).
- [ ] **Registration card / ID capture at check-in** — diagram lists guest "ID (optional)"; noted already in the Check-in bullet as not built. Low priority: an ID-photo upload + printable registration card at check-in, reusing `lib/server/uploads.ts`.

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

### Cashier + internal Finance (landed 2026-09-07 — Phase 3 pulled forward, cash-basis only)
- [x] **Front desk is now a real cashier.** The one-click "Settle balance" is replaced by a payment dialog (`$lib/components/staff/payment-fields.svelte`): method (cash / card / GCash / Maya / bank transfer / cheque), any amount (deposit / partial / full), cash tendered → live change, reference / bank / cheque-date for non-cash. `lib/server/finance/payments.ts` `recordPayment` writes the `payments` row (new columns: `method`/`purpose`/`folioId`/`cashAccountId`/`shiftId`/`tenderedCentavos`/`changeCentavos`/`referenceNo`/`bankName`/`chequeDate`/`recordedByUserId`/`voidedAt…`) **and** a matching `cash_movements` row in one tx. `voidPayment` soft-voids + reverses the cash movement; `refundPayment` pays a credit back out. Walk-in creators (`createWalkInBooking`/`createWalkInHallBooking`) take a `payment` block and route through `recordWalkInPayment`. The PayMongo webhook posts online receipts into the Undeposited Funds account. `getFolioDetail` now excludes voided payments and nets negative refund rows. `settleFolioBalance` removed.
- [x] **Cashier shifts** (`cashier_shifts`, `shift_events`) — open a shift against a drawer (front-desk header), take cash against it, record payouts / cash-drops / float-pickups, close with a counted-vs-expected variance that posts an over/short `adjustment` movement. `finance/shifts` + `finance/shifts/[shiftId]` (printable reconciliation). A cash payment requires an open shift when `finance_settings.requireOpenShiftForCashPayment`.
- [x] **`/{slug}/finance`** — dashboard (cash position, cash-in/out today, revenue MTD, drafts / AR / open shifts, day-close), `cash` (accounts + movement ledger + transfer / bank deposit / manual entry + void), `expenses` (vendors, categories, input VAT split, receipt-photo upload, draft→approve→pay lifecycle; `expenses/recurring` templates + "generate due"), `receivables` (city ledger from the checkout override, aging buckets, collect / write-off), `reports` (daily-sales, cash-position, cashflow, revenue-by-source, expenses, payment-methods, ar-aging — on-screen + `?…/export` CSV), `settings` (cash-account / category / vendor CRUD + preference toggles + default accounts).
- [x] **Day close** (`day_closes`) — `runDayClose` snapshots the day's totals and locks the date (`assertBusinessDateOpen` guards every dated Finance write); `hotel_admin` can reopen.
- [x] Checkout with an outstanding balance — `hotel_admin` can "charge to city ledger": `openReceivable` squares the folio with a `house_use` payment and the debt moves to `receivables`, collected later in `finance/receivables`.
- [x] RBAC — `front_desk` gains `payment:*` / `shift:*` / `finance:read` (cashier, not back office); `accountant` gains explicit `expense:*` / `receivable:*` / `dayclose:*` / `shift:*`. New hotels get `seedFinanceDefaults` (accounts + settings + categories) on create; `scripts/backfill-cash-movements.ts` fills historical payments.
- **Deferred:** chart of accounts / journal entries / trial balance / income statement + `@mm/finance-core` extraction (still Phase 5); PDF rendering (HTML print only); true BIR OR series; F&B/POS revenue (manual `other_revenue` only); payroll postings (Phase 4); bank-statement import / PayMongo payout auto-reconciliation; `pg-boss` cron for recurring expenses (manual button for now).

### Front desk `/{slug}/front-desk`
- [x] Bookings list + filters (arrivals, departures, in-house) — `/{slug}/front-desk` is now a room-status grid (`getRoomStatusGrid`, business-date resolved via the hotel's own timezone): every physical room as one cell (vacant/occupied/departing-today/reserved/out-of-order), grouped by floor, with a room-type filter + guest/room search. Clicking a room shows its booking (guest, dates, occupancy, rate plan, total, payment channel — online vs. walk-in, derived from `payments.provider` — special requests) in a side rail; the rail defaults to flat Arrivals/Departures tabs when no room is selected. A "reserved" flag can only ever point at a room *type* (every unassigned confirmed arrival of that type today), never a specific room — `room_assignments` rows don't exist until check-in. `/{slug}/reservations` remains the separate all-time/filterable verification list
- [x] Walk-in create — folded into `/{slug}/front-desk` itself as a slide-in drawer (no more separate `/front-desk/walk-in` route): staff pick an available room type/rate for chosen dates (`?/walkInSearch` action, reusing `searchAvailability`), `createWalkInBooking` creates guest+order+booking as `confirmed` with a `cash` payment row (settled on the spot, no PayMongo session — `?/walkInCreate` action), then hands off to the existing reservation-detail check-in UI. Clicking "Walk-in this room type" on a vacant room's grid cell opens the same drawer pre-selecting that type
- [x] Check-in: assign room — already existed (`checkInBooking`), now also linked from the grid's arrivals rail. Registration card / ID capture upload still not built
- [x] Check-in/check-out time policy + extension fees — own settings page now, `/{slug}/settings/check-in-out` (moved off `/settings/branding`, which keeps only the guest-facing `checkInPolicy`/`checkOutPolicy` free text): `hotels.checkInTime`/`checkOutTime` (default 14:00/12:00) plus per-hour `lateCheckoutFeePerHourCentavos`/`earlyCheckInFeePerHourCentavos` (default 0 — a rate, not a total; front desk judges the hours and multiplies, nothing tracks actual arrival/departure time). Surfaced on the front desk's room panel — the times on arrivals/departures badges, the fees as a reference note ("Late checkout fee: ₱X/hour — quote for however many hours and collect in person") on a departing room or a reserved room's arrivals. Reference only, by design: no folio/charge record is created, nothing is added to `bookings.totalCentavos` — actually billing this needs the folio system below. There's still no "extend stay" flow (adding a night to an existing booking): `bookings.checkIn`/`checkOut` remain fixed at creation with no update path once a guest wants to push their checkout date out
- [x] Function halls — a "Function halls" board below the room grid (`getHallStatusBoard`): every active hall with today's paid (`confirmed`/`completed`) events (guest, event type, time, guest count, payment channel, total). "Walk-in event" opens a per-hall drawer (`createWalkInHallBooking` — same cash-settled-on-the-spot posture as room walk-ins) that shows a live rate breakdown as front desk adjusts date/time (base price for the hall's included hours, extra-hour rate × however many hours over, fees, VAT, total) before they commit. Its own quote endpoint, `/{slug}/front-desk/api/hall-quote` (distinct from the guest-facing `/book/api/hall-quote`, which only prices — a conflict there is only ever caught at order-creation time, after the guest's already gone through checkout), checks `checkHallAvailability` *before* pricing, so front desk sees "already booked for that time" immediately while adjusting the slot rather than only on submit; `createWalkInHallBooking` still re-checks at creation time regardless, inside the same advisory-locked transaction, so a real double-booking can't be persisted even if two front-desk sessions race each other. A confirmed event gets a "Mark completed" action (`completeHallBooking`) — the closest hall equivalent to a room's check-out, staff's own judgment call on timing since nothing tracks the event's real end time
- [x] Folio: auto room-night charges + incidental charges — `lib/server/folio.ts` + schema (`folios`, `folio_charges`, and `amenity_items` pulled forward from Phase 2 as the priced catalog charges are sold from). `getOrCreateFolio`/`getFolioDetail` creates one per booking on first touch, seeded with a single line equal to the booking's own already-priced total — that line's matching payment already exists (the original booking payment), so the folio starts exactly balanced and only owes anything once a new charge is added without a matching new payment. Front desk adds charges from the catalog (`addAmenityItemCharge`, quantity × the item's price, VAT applied per the item's own `taxable` flag) or one-click from the per-hour extension-fee rates (`addExtensionFeeCharge`, hours × the configured rate, non-taxable) — both surfaced in the "Full details" dialog's new Folio section, replacing the old plain "Bill" breakdown. `settleFolioBalance` pays off the balance in cash (a `payments` row against the booking's order — same table/mechanism walk-ins already use); check-out (`checkOutBooking`) now refuses to proceed while `balanceCentavos > 0`, closing the folio on success. Settings CRUD at `/{slug}/settings/amenity-items` ("Sellable items" — name, category, price, taxable, active, sort order; delete blocked once an item's actually been charged to a guest, deactivate instead). **Folios are polymorphic** — `folios.bookingId`/`hallBookingId` are both nullable with a `folios_exactly_one_target` check constraint, since a folio can belong to either a room booking or a function hall booking (the initial pass only wired up rooms; a function hall's board had no "open this booking" affordance at all, so its charges were unreachable — fixed by giving `lib/server/folio.ts`'s functions a `FolioTarget` discriminated union and adding a matching "Full details" dialog + `?/hallDetail`/`?/addHallItemCharge`/`?/settleHallFolio` actions to the Function Halls board, reusing `getHallBookingDetail` the same way the room dialog reuses `getRoomBookingDetail`). Extension fees (`addExtensionFeeCharge`) stay room-only, a hall reservation has no check-in/check-out clock to extend. A hall booking's folio has no check-out-style balance gate — `completeHallBooking` ("Mark completed") doesn't block on it, unlike `checkOutBooking` for rooms. A charge can now be voided (`voidFolioCharge` — `?/voidCharge`/`?/voidHallCharge`), soft-deleted (`voidedAt`/`voidedByUserId`/`voidReason`, excluded from the balance calc but still shown struck-through on the folio for audit purposes) rather than hard-deleted; the seeded base stay charge (`isBaseCharge`) can never be voided. Still no invoice/OR document generation — that's a separate, still-open item below
- [~] Check-out — `checkOutBooking` flips a checked-in booking to `checked_out`, from either the departures list or straight off an "Occupied" room ("Check out early" — takes a `businessDate` param now, and when it's before the booking's original `checkOut`, also caps the room's `room_assignments.checkOut` at today; otherwise a checked-out-but-still-in-its-original-date-range assignment would keep blocking that physical room from any new booking for the nights the guest gave up, even though the front-desk grid already shows it vacant). Now actually blocks on an unsettled folio balance (see the folio bullet above) — a fresh booking with no incidental charges still checks out freely, since its seeded folio line nets to zero against its original payment; no proration/refund for an early checkout's unused nights either. Invoice/OR generation and "release room → housekeeping dirty" still TODO (need `invoices`/`official_receipts` schema + PDF rendering, and a housekeeping-status column on `rooms` — none of which exist yet)

### Documents & email
> Delivery mechanism for the **Accountable-forms module** and **Guest confirmation
> email** items in the Client flow reconciliation above. The document schema, series,
> and templates all live in that module's bullet — this section is just the render
> helper + email transport.
- [ ] `lib/server/pdf/render.ts` (Playwright chromium.pdf) — renders any `/{slug}/print/*` route to an A4 PDF; consumed by the Accountable-forms module (Invoice, OR, X/Z readings, liquidation register) and the confirmation email
- [ ] `lib/server/email/` (nodemailer + templates): booking confirmation (Invoice/OR PDF attached), payment receipt, pre-arrival — SMS variants are post-MVP

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

> **Most of this shipped early, app-local + cash-basis, on 2026-09-07** (see the
> "Cashier + internal Finance" block under Phase 1). What remains here is the
> portable-standard / double-entry / integration work.

- [ ] `@mm/finance-core`: canonical `cash_movement` record, `cash_account` model, COA taxonomy + `type`/`subtype` enums, closed `category` enum; finalize `docs/standards/finance.md` — **not started; the app has its own `cash_movements`/`cash_accounts` in `schema/finance.ts` to extract from**
- [ ] `@mm/finance-core` unit tests (enum conformance, cash-movement schema, money math)
- [x] App schema: `expense_categories`, `vendors`, `expenses` (input VAT, attachment, status draft/approved/paid), `recurring_expenses` — in `schema/finance.ts`
- [x] Every expense / room payment / amenity sale / deposit writes a `cash_movement` — app-local `cash_movements` via `lib/server/finance/cash.ts`'s `recordCashMovement` (the single choke point); `source_app`/dimensions/outbox still TODO with `@mm/finance-core`
- [x] `/{slug}/finance`: expense entry + approval workflow, cash accounts (petty cash / bank / e-wallet)
- [x] Cashflow view: cash-in vs cash-out per account; daily cash position
- [x] Shift / day close with expected-vs-counted reconciliation
- [x] Daily sales report
- [ ] `@mm/integration`: `GET /api/v1/finance/accounts|cash-movements` + `cash_movement.recorded` outbox event + `outbox` table + dispatcher
- [x] Verify: expense from petty cash → day close reconciles → cashflow shows booking payment (in) + expense (out) — verified end-to-end against the demo hotel

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
