# Dining: online ordering, table reservations, finance

## Context
Dining today is only a marketing page (`dining_items`: photos, hours, intro text; `hotels.config.dining` menu photos) with settings at `/{slug}/management/settings/dining`. There are no priced menu items, tables, orders, payments, or finance link. The client wants: online menu ordering (add-ons, remarks), table booking, online payment, checked-in guests able to order/book, dining income visible in finance, and a top-level Dining menu in the staff app that absorbs the dining settings.

## Decisions (confirmed with user)
1. **Folio: hybrid.** Dining order is its own record + own payment path. Online / cashier payments never touch the folio. In-house guests get an extra "Charge to room" option that posts ONE folio line.
2. **Revenue:** new `dining_revenue` cash category + COA account. Room-charged dining is tagged on the folio line and apportioned to dining revenue when the folio is settled.
3. **Tables: full floor plan.** Named tables with seats, conflict checks with turn time.
4. **Reservations:** table-only, or with optional menu pre-order; pay online now or at venue.

## Why not fold dining into the room folio
- A folio exists only for a room/hall booking (`folios_exactly_one_target`); walk-in and outside diners have none.
- `payments.orderId` is NOT NULL and the PayMongo webhook/refund code is keyed on `metadata.orderId` -> `orders`; dining needs its own path regardless.
- `recordPayment` books any folio settlement as `room_revenue` (payments.ts ~148-155), so without apportioning, dining income disappears into room revenue.

## Phases (each ships independently; run `impeccable` before each UI surface)

### Phase 0 - Design approval
Run `impeccable` for: (a) staff Dining module (operate mode, shadcn), (b) guest dining ordering + reservation (Woven Ledger). Present direction before code. Update `PRODUCT.md`/`DESIGN.md` when shipped.

### Phase 1 - Staff Dining module + menu data
- Sidebar: add **Dining** to `management/+layout.svelte` (lines ~59-111). Sub-pages: Orders, Reservations, Menu, Floor plan, Settings. Move `settings/dining/*` (venues, intro, menu photos) under `/{slug}/management/dining/settings`; keep a redirect from the old path and drop/repoint the tile in `settings/+page.svelte`.
- Caps: add `dining:read`, `dining:write`, `dining:manage` to `src/lib/authz.ts` `PERMISSION_CATALOG`; settings stay `hotel:admin`-or-`dining:manage`.
- New schema (`src/lib/server/db/schema/dining.ts`, all with `hotel_id`, scoped queries):
  - `dining_menu_categories`, `dining_menu_items` (venue FK to `dining_items`, price centavos, taxable, image, availability/schedule, `is_active`, sort).
  - `dining_addon_groups` / `dining_addons` (price, min/max choices, attach to item or category).
  - Venue extras on `dining_items`: seating hours, slot length, turn time, online-ordering on/off.
- Menu management UI; guest read-only menu on the existing `/{slug}/dining` page (extend `(guest)/+layout.server.ts` load).

### Phase 2 - Table floor plan + reservations
- Schema: `dining_tables` (venue, name, seats, area, position x/y for floor plan), `dining_reservations` (guest name/contact, party size, start/end, status pending/confirmed/seated/completed/no_show/cancelled, remarks, optional `booking_id` for in-house guests, optional `dining_order_id`), `dining_reservation_tables`.
- Availability engine `src/lib/server/dining/availability.ts`: free tables for (venue, start, party size) using turn time; advisory lock on create (same pattern as `createOrder` in `details/+page.server.ts`).
- Staff floor-plan view (drag tables, seat/complete reservations); guest slot picker -> `/{slug}/dining/reserve`.
- Business date/timezone from hotel `timezone`.

### Phase 3 - Dining orders + cashier payment + finance
- Schema: `dining_orders` (venue, reservation?, guest?, `booking_id?` for in-house, type dine_in/takeaway/pre-order, status, remarks, totals, `access_token`), `dining_order_items` (snapshot name/price/qty, remarks), `dining_order_item_addons` (snapshot).
- Pay at cashier: copy `createStandaloneSale` (`src/lib/server/finance/standalone-sales.ts`): `resolvePaymentAccount` -> `recordCashMovement({category:'dining_revenue', sourceType:'dining_order', shiftId})` in one transaction. Shift reconciliation and day-close then work unchanged.
- Finance category (migration pattern of `drizzle/0044`): add `dining_revenue` to `cash_category`; add COA 4040 "Food & Beverage Revenue" to `COA_SEED` and `CASH_CATEGORY_TO_COA_CODE` (`finance/coa-seed.ts`, type-enforced); run `db/migrate-backfill-coa.ts` for existing hotels. Update hardcoded revenue lists or dining silently drops from totals: `finance/reports.ts` (`REVENUE_CATEGORIES`, `revenueBySourceReport` SQL list, `dailySalesReport`), `finance/dayclose.ts` (`revenueCats`), `finance/readings.ts`, labels (`report-runner.ts` `labelSource`, finance `+page.svelte` `sourceLabel`), `lib/daily-stats.ts`, `docs/standards/finance.md`, API docs.
- Staff Orders screen (kitchen-style status board: new -> preparing -> served -> paid) with booking code + guest name on every row (traceability rule).
- Dining sales report by venue/item/day.

### Phase 4 - Online ordering + online payment (PayMongo)
- Guest flow under `/{slug}/dining/order` -> review -> pay -> confirmation, token-guarded like `review/[orderId]`; cart supports add-ons + remarks; reservation can attach a pre-order. Gate with `isOnlinePaymentEnabled(hotelId)`; "pay at venue" allowed per venue setting.
- Checkout: reuse the PayMongo client (`getPaymongoClient`, `createCheckoutSession`) with metadata `{kind:'dining', diningOrderId}` (no `orderId`).
- **Webhook** (`paymongo/webhook-handler.ts`): add a `kind==='dining'` branch before the order-based logic: idempotent via event id, record payment, `recordCashMovement` to `undepositedAccountId` with `dining_revenue`, mark dining order paid / reservation confirmed. Extend the hotel-resolution helper (`eventHotelId`) to resolve dining orders.
- Payment record: **dedicated `dining_payments` table** (recommended) instead of loosening `payments.orderId`, to avoid touching every `orders` join (reports, receipts, `listBookingTransactions`). Trade-off: add dining rows to the PayMongo transactions list (`finance/paymongo-transactions.ts`) and payment-method breakdown reports.
- Refunds: parallel `refundDiningOrderViaPaymongo` modelled on `refundOrderViaPaymongo` (QR Ph fallback included); cancellation rules per venue.
- Unpaid online dining orders expire on a sweep like `expirePendingOrders`, scoped to dining.
- Official Receipt: decide with BIR settings whether dining online payments issue ORs (`issueOfficialReceipt` is payment/order-bound today).

### Phase 5 - In-house guests: charge to room
- Add nullable `source` (e.g. `'dining'`) + `dining_order_id` to `folio_charges`.
- New `addDiningCharge(hotelId, target, order, actor)` wrapper over private `insertCharge` in `folio.ts` (one summarized line, audited); void via `voidFolioCharge` also voids/reopens the dining order payment state.
- Guest identification: in-house guests order via `manage/[orderId]` (access token) or staff attach booking at the cashier (room lookup). Only `checked_in` bookings are eligible; show booking code + guest name.
- Apportioning: in `recordPayment` / `recordOrderPayment` (`finance/payments.ts`), split the cash movement by charge source so the dining portion is posted as `dining_revenue`, the rest `room_revenue`. Keep one payment row; multiple cash movements share it. Add `ledger:check` coverage.
- Guard checkout: existing balance check already blocks while dining charges are unpaid; invoice picks the line up automatically.

## Risks / open items
- Apportioning in `recordPayment` is the riskiest change (touches core cash choke point, voids, refunds, partial payments: allocate dining first or pro-rata - decide in Phase 5 design).
- `voidPayment` does not post journal reversals today; dining voids should use `voidCashMovement`.
- Seed/backfill COA for existing hotels; migration order (enum value add needs its own migration).
- Guest scope: no nationality collection (see memory); minimal guest fields for walk-in reservations (name, phone/email).
- Mailgun conversation work is separate; dining confirmation emails use existing email path for now.

## Verification
- `pnpm check` and unit tests for availability engine, order totals/tax, apportioning math.
- `pnpm ledger:check` after each finance phase; confirm day-close, X/Z readings, revenue-by-source include dining.
- PayMongo test mode end to end (checkout -> webhook -> paid; failed; refund; QR Ph) following `docs/paymongo-test-plan.md`; no live keys until user says so.
- Scenario matrix: walk-in cash, outside guest online, in-house charge-to-room settled at checkout (verify dining vs room revenue split), cancellation/refund, double-booking race on the same table.
- Browser testing only if the user asks; isolate `UPLOADS_DIR` for any upload tests.
- Update `docs/TODO.md`, `PRODUCT.md`, `DESIGN.md`.

## Addendum - tracking, messaging, kitchen board (added after design review)

- **Status model:** order = new, accepted, preparing, ready, served, cancelled; reservation = pending, confirmed, seated, completed, no_show, cancelled. Status changes are audited and timestamped (`dining_order_events`).
- **Reference codes:** short code per order/reservation (e.g. `DN-7K4Q`), mono register on guest surfaces.
- **Guest tracking page:** `/{slug}/dining/track/[code]?t=token` - progress strip, details, table/pickup time, live polling (same pattern as booking confirmation), message box via `guest-messages.ts`. Dining messages fold into the planned Mailgun thread.
- **Download + email:** print route `/{slug}/print/dining-order/[id]`; confirmation email with code, details, tracking link; re-sent on Ready / Confirmed.
- **Charge to room -> kitchen:** room-charged orders are normal dining orders with `booking_id`; they appear on the Orders board and kitchen board showing room, booking code, guest. Folio line links to `dining_order_id`; void is bidirectional.
- **Kitchen board:** `/{slug}/management/dining/kitchen`, full-screen, oldest-first, columns New / Preparing / Ready, timers that turn red when late, remarks/allergies bold, optional ready chime. New cap `dining:kitchen`.
- **Open:** single kitchen board with optional station tag on menu items (recommended) vs per-station boards; email + live page only (recommended) vs SMS/push.

### Decisions confirmed (addendum)
- **Kitchen:** one kitchen board. Menu items carry an optional `station` tag (nullable text, e.g. kitchen/bar/pastry) stored from Phase 1 so splitting into per-station boards later needs no data migration. The board ignores it for now (later: filter/tab per station).
- **Guest alerts:** email + live tracking page only. No SMS/push in this release.
