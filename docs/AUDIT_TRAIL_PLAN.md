# Audit trail for dining tracking numbers

> **Status: built 2026-10-14** (see the TODO entry; verified by `pnpm check` only, Playwright spec `e2e/audit-trail.spec.ts` not yet run). Written 2026-10-13 after reading the code. The plan below is kept as designed; everything below is
> self-contained. Decisions already made are listed under "Decisions".

## Goal

Give any dining tracking number a full, start-to-finish record that shows **who did each step**, with a proper report you can print or export.

- A dining order `DN-XXXX` or a table reservation `TB-XXXX` (and everything that belongs to it: its pre-orders, payments, receipts and invoices,
  refunds, messages, kitchen steps, table moves).
- One page that reads in time order, from the first click to the last refund.
- Works on records that already exist, not only new ones.

## Decisions (already made)

| Question | Decision |
|---|---|
| Scope of this round | **Dining only.** The trail builder is written generically so room and hall bookings can follow. |
| Device details | **Record IP address and browser for staff and guests.** Shown to **hotel admins only**. Guest IPs are personal data under the Data Privacy Act, so the page says so and dining-only staff never see them. |
| Testing | **Playwright specs only, no new vitest.** Specs are generated for you to run by hand (your standing preference). |
| New permission? | **No.** Reuse `dining:read` (who / when / what / amounts) and `hotel:admin` (IP, browser, before/after JSON), the same rule Find by number already uses. |

## What is wrong today (found in the code)

1. **The Audit log page is thin.** `settings/audit` shows the newest 300 rows with an 8-character id. Only an entity-type dropdown filters on the
   server; there is no date range, action, actor or tracking-number filter, no pagination, no export. `ACTION_LABELS` has nothing for dining, so
   entries read as "Create" or "Status". Only `booking`, `hall_booking` and `cashier_shift` ids link anywhere.
2. **Guests and the system look the same.** A guest cancelling, PayMongo confirming a payment and a background expiry all store `actor = null` and show
   as "System". The only hint is `after.source` or the action name.
3. **No device information.** `audit_log` has no IP, browser or request id.
4. **The trail is fragmented.** Related events are filed under different ids: `dining_order` (order id), `dining_table_check` (check id), `document`
   (receipt id), `cash_movement`, and the room folio for a room charge. Find by number's DN trail follows only the order id; a TB trail follows only the
   reservation id and misses its pre-orders.
5. **Missing events.** No record of: PayMongo checkout started, failed or expired; a pre-order being held, released on seating, or auto-cancelled by a
   reservation cancel or no-show; force-clear marking paid orders served; a settle summary (tendered, change, document numbers); guest and staff messages.
6. **Thin payloads.** `dining_order.paid` has no tendered, change, shift or movement id. `dining_order.void_payment` has no amount, method, movement id or
   the receipt number it cancelled. `dining_order.create` omits order type, reservation link, pay mode, guest and lines. A guest cancel keeps no reason.
7. **Audit rows are not transaction-safe.** `writeAudit` inserts through the global `db`, so inside a transaction it commits on its own and can survive a rollback.
8. **Dining-only accounts cannot reach Find by number.** The sidebar item is shown for `booking:read` or `finance:read` only, though the page itself allows `dining:read`.
9. **No dining history table exists** (`docs/dining-plan.md` mentions `dining_order_events`, which was never built). State lives in timestamp columns,
   `dining_payments`, `dining_order_messages`, `cash_movements`, `documents` and per-line kitchen times.

## Design

Two layers, so old data helps too:

1. **Capture**: new audit entries are richer (actor kind, where from, tracking number, fuller payloads, missing steps).
2. **Trail**: one function gathers everything related to a tracking number from the tables that already hold it and merges it into one timeline. It follows
   the links already stored (order to check, reservation, documents, cash movements, payments, messages, kitchen line times), so it works on old rows with no backfill.

### Part 1: Capture

**1a. Four additive columns on `audit_log`** (migration `0093`; all nullable or defaulted, no data change):
`actor_kind` (`staff | guest | system`, default `system`), `ip_address`, `user_agent`, `ref_code` (the DN- / TB- code).
Indexes on `(hotel_id, created_at)` and `ref_code`. File: `apps/hotel/src/lib/server/db/schema/audit.ts`.

**1b. Where-from, without touching every call site.** `hooks.server.ts` (`handle`, line ~72) runs `resolve` inside an `AsyncLocalStorage` request
context `{ ip, userAgent, path, hasSession }` (new `lib/server/request-context.ts`; the Node adapter supports it). `writeAudit` (`lib/server/audit.ts`)
reads it automatically:

- `actor_kind`: `staff` when an actor is passed; `system` for webhook and background paths (`/api/**`, or no request at all); `guest` for any other
  public request. A caller can override.
- `ip_address` from `event.getClientAddress()`, `user_agent` from the request header, both truncated.
- New optional params: `refCode`, `actorKind`, and `tx`, so an audit written inside a transaction commits or rolls back with the change.

**1c. Every dining entry carries its tracking number, and the missing steps are recorded.**

Pass `refCode` (order code or reservation code) and put `orderId` / `reservationId` / `checkId` in `after` on all existing dining audit calls:

| File | Lines |
|---|---|
| `lib/server/dining-orders.ts` | 327, 431, 510, 549, 585, 616, 647, 767, 858 |
| `lib/server/dining-online.ts` | 475, 701, 716, 743, 888 |
| `lib/server/dining-reservations.ts` | 296, 464, 514 |
| `lib/server/dining-room-charge.ts` | 150, 200 |
| `lib/server/dining-checks.ts` | 245, 286, 471, 578 |
| `lib/server/finance/documents.ts` | 1174, 1420 |
| `lib/server/finance/cash.ts` | 207 |

Richer payloads:

- `dining_order.create`: order type, reservation id, table, pay mode, fulfilment, delivery fee, guest name and phone, line count and names.
- `dining_order.paid`: method, tendered, change, shift id, cash account, cash-movement id, OR or invoice number issued.
- `dining_order.void_payment`: amount, method, movement id, the receipt number cancelled (stored as `before`).
- Guest cancel and cancel request: the reason text.

New entries (hook points):

- PayMongo checkout started, failed, expired: `dining-online.ts` 261 and 328, 499 to 516, 519 to 550, expiry loop 288 to 291.
- Pre-order held, released on seating (`attachPreOrdersToCheck`, `dining-reservations.ts` 332 to 381) and auto-cancelled by a reservation cancel or no-show
  (`releasePreOrders`, 389 to 427): one entry per order.
- Force-clear marking paid orders served (`dining-checks.ts` 271), and one settle-level entry with tendered, change and document numbers (`settleCheck`, 133).
- Guest and staff messages (`dining-online.ts` 746 and 760): who, direction, first 200 characters (full text stays in `dining_order_messages`).
- Receipt reprint is **not** audited (viewing a document is not a change). Follow-up if wanted.

### Part 2: The trail (read side)

**2a. `lib/server/dining-trail.ts` (new).** `buildDiningTrail(hotelId, ref)` resolves a DN or TB code (reuse `resolveNumber` in `lib/server/lookup.ts`) to a
**related set**: order id(s), reservation id, table-check, document ids, cash-movement ids, payment ids, and the folio charge or booking for a room charge.
A TB reservation includes every linked pre-order; a DN pre-order includes its reservation.

It returns a chronological list of events:

```
{ at, actor: { kind, label, userId? }, action, label, detail, amountCentavos?,
  source: 'audit' | 'record', ip?, userAgent?, before?, after? }
```

merged from:

- `audit_log` rows matching `(entityType, entityId)` for every id in the set, plus `ref_code`.
- Timestamps on `dining_orders` (created, accepted, ready, served, cancelled, paid, out for delivery, cancel requested) and `dining_order_items` (cook start and ready, with names).
- `dining_payments` (attempts, failures, expiries, refunds, who recorded), `dining_order_messages` (author), `cash_movements` (including voids, who recorded, shift),
  `documents` (issued, cancelled, replaced, with who), table-check open / bill / close, reservation created and by whom.

A record-derived row is dropped when an audit entry already describes the same step, so nothing is listed twice. Old rows without `actor_kind` read
"Staff" when a user is attached, otherwise "Guest or system (not recorded)".

It also returns:

- **Who handled it**: created by, accepted by, cooked by, paid by, refunded by, receipt issued by.
- **Money**: billed, paid by method, refunded, net, OR and invoice numbers.

**2b. New page `management/trail/[ref]`** (`+page.server.ts`, `+page.svelte`).

- Gate: `dining:read` for who / when / what / amounts. **IP, browser and before/after JSON: `hotel:admin` only.**
- Layout (staff operate mode, shadcn table and badge; patterns from `lookup/+page.svelte` lines 74 to 139 and `settings/audit/+page.svelte` lines 205 to 228,
  with a shared `lib/components/staff/audit-detail.svelte` extracted from the two): header (code, type, venue, guest, status), **Who handled it** cards, money summary,
  documents, then the timeline (When in hotel timezone, Who with a Staff / Guest / System badge, What, Details, expand for device and before/after). Buttons: **Print** and **CSV**.
- Entry points: Find by number's DN and TB hits get an **Open full trail** link; `lookup.ts` refs for dining hits now include the related ids (closing the DN and TB gaps);
  order and reservation cards on Dining Orders and Reservations get a small **Trail** link; the sidebar shows **Find by number** for `dining:read` accounts too
  (`management/+layout.svelte` lines 104 to 111).

**2c. Audit log page** (`settings/audit/+page.{server.ts,svelte}`, `lib/server/audit.ts`).

- Server-side filters: date range, action, actor, entity type, tracking number or entity id. Pagination (50 per page, backed by the `created_at` index).
- Dining ids in the Entity column link to the trail (`entityHref` knows only booking, hall_booking and cashier_shift today).
- `ACTION_LABELS` gets every `dining_*`, `bir.*` and `finance.void_cash_movement` action in plain words.
- Actor kind badge; IP and browser in the expanded row; **CSV and Print** of the filtered range.

**2d. Reports** (reuse, no new report engine).

- **Order trail report**: a `ReportDoc` (`lib/dining-report-doc.ts` pattern, new `buildTrailDoc`) with sections Summary, Who handled it, Money, Documents, Timeline.
  Printed by `components/print/report-sheet.svelte` at `print/dining-trail/[ref]`; CSV at `management/trail/[ref]/csv` via `docToCsv`, with `safeCell`
  (`lib/server/booking-transactions-csv.ts`) on guest-typed text. Prepared-by / Reviewed-by lines like the other sheets. IP and browser are printed only for hotel admins.
- **Audit register**: the filtered Audit log as a printable A4 register and CSV, same shell.

## Out of scope for this round

- Room and hall booking trails (the builder is generic; do these next).
- Back-filling IP and actor kind on old rows (they show "not recorded").
- Auditing document reprints.
- A new permission.
- Changing how money is recorded.

## How to start (checklist)

1. Migration `0093` and the schema change; `request-context.ts` and the `hooks.server.ts` wrapper; extend `writeAudit` (`refCode`, `actorKind`, `tx`).
2. Add `refCode` and the richer payloads to the existing dining audit calls (table above).
3. Add the missing events (checkout started / failed / expired, pre-order held / released / cancelled, force-clear, settle summary, messages).
4. `dining-trail.ts`, then the `trail/[ref]` page, then wire the entry points (Find by number, Orders and Reservations cards, sidebar).
5. Audit page filters, pagination, labels, links, CSV and print.
6. Trail print sheet and CSV (`buildTrailDoc`), then the audit register.
7. Generate `e2e/audit-trail.spec.ts`, update `docs/TODO.md`, and add the convention below to `docs/standards/`.

**Convention to record once built:** every mutation calls `writeAudit` with `refCode`, inside its transaction, and a guest or system action is never logged as a staff user.

## Verification (when built)

- `pnpm check`; `drizzle-kit generate` shows no drift after `0093`; `pnpm db:migrate`.
- **Playwright only**: `e2e/audit-trail.spec.ts`. Take a dining order and a reservation through their steps (reserve with pre-order, pay, kitchen, served, refund or void),
  then open `management/trail/DN-...` and `TB-...` and assert the events and who-labels appear in order and the money summary matches. Also: Print and CSV render; the
  audit page filters and paginates; a dining-only login sees the trail but not IP or before/after.
- Manual: a guest cancels a pre-order from the website, and the entry says Guest with their IP; a PayMongo payment shows System.
- Update `DESIGN.md` if the print sheet gains a new section.

## Critical files

- **Schema and capture:** `lib/server/db/schema/audit.ts`, migration `0093`, `lib/server/audit.ts`, new `lib/server/request-context.ts`, `hooks.server.ts`.
- **Hook points:** `lib/server/dining-orders.ts`, `dining-online.ts`, `dining-reservations.ts`, `dining-checks.ts`, `dining-room-charge.ts`, `dining-qr.ts`, `finance/documents.ts`, `finance/cash.ts`.
- **Trail:** new `lib/server/dining-trail.ts`, `lib/server/lookup.ts` (refs), new `routes/[hotel]/management/trail/[ref]/*`, `routes/[hotel]/print/dining-trail/[ref]/*`, `lib/dining-report-doc.ts`.
- **UI:** `routes/[hotel]/management/settings/audit/*`, `routes/[hotel]/management/lookup/*`, `routes/[hotel]/management/+layout.svelte`, new `lib/components/staff/audit-detail.svelte`.
- **Reuse:** `resolveNumber` and `auditTrail` (`lookup.ts`), `report-sheet.svelte`, `docToCsv`, `safeCell`, `ui/table`, `ui/badge`.

(All paths are under `apps/hotel/src/` unless they start with `docs/`.)
