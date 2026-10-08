# Dining table service: station-ready, table check and close, QR ordering, kitchen timers, UI fixes

Follow-up to `docs/dining-plan.md` (which covers Phases 1-5 and the kitchen board). Status is tracked in `docs/TODO.md`.

## Context

Dining works per order today, and testing showed several gaps:

1. **Tables stay occupied forever.** `dining_tables` has no status. "Seated" comes only from reservations (`floor-plan/+page.svelte:63-76`) and clears only when staff click Complete. Walk-in orders never mark a table occupied, and nothing groups a table's orders or closes the table.
2. **Station-split cooking is not tracked.** `dining_order_items` has a `stationId` snapshot, but there is one `status` per order, so any station's "Ready" marks the whole order ready.
3. **The kitchen has weak timing UI.** It shows a single "N min" from `createdAt`, with colour-only warning at 10 min. There is no per-station time, no "ready since", and no `1h 05m` format.
4. **There is no table QR ordering.** There is no per-table token, no `?table=` flow, and no QR renderer. The guest order page is takeaway and pre-order only.
5. **UI bugs hit in use:**
   - **Add-table sheet keeps closing.** `floor-plan/+page.svelte:147-153` has a `$effect` that sets `sheet.open = false` whenever `form.ok` is set. `form` stays set after the first save, and reopening reassigns `sheet`, so the effect re-fires and closes it. `addons/+page.svelte:40-47` has the identical bug. Commit `4c19ba5` already fixed this pattern in `menu/+page.svelte:64-77` with `untrack`.
   - **New-order sheet is cramped.** `ui/sheet/sheet-content.svelte` hard-codes `data-[side=right]:sm:max-w-sm`. It out-specifies the caller's `sm:max-w-4xl`, so the two-pane sheet renders at 384px. The grid also has no mobile layout, so the cart and its buttons fall off-screen.
   - **Poll resets.** While the orders board polls every 20s, `new-order-sheet.svelte:67-81`, `thread-sheet.svelte:56-62` and `refund-dialog.svelte:36-42` re-run reset effects. This probably wipes the cart or a half-typed reply.

The outcome is a full table lifecycle: scan, order, staff accept, per-station cook, ready for the table, settle the check, table freed. The kitchen shows how long everything has waited, and the dining tabs are consistent and bug-free.

## Decisions (confirmed with user)

- **Close flow:** a table check groups the table's orders. "Settle & close" pays everything and frees the table. A manager can force-clear.
- **Areas:** real areas per venue, one floor-plan canvas per area.
- **QR orders:** staff must **accept** each QR order before the kitchen sees it.
- **Menu photos:** the item dialog already uploads a photo (commit `4c19ba5`). The work is to show it in the staff sheet and the QR menu, and to flag dishes without one.

## Design direction (needs approval before building)

The `impeccable` skill is required by `CLAUDE.md` for new or redesigned surfaces. It was not available in the planning session, so the direction below is proposed. Run `impeccable` before Phase 4 if a formal pass is wanted.

- **Staff surfaces (kitchen, orders, floor plan, tabs):** operate mode, neutral shadcn + oklch tokens from `app.css`.
  - Hairline cells, Inter 600, `tabular-nums`.
  - Status is shown with **icon + text + colour**, never colour alone. Use the existing `--warning` and `--danger` tokens in place of raw `amber-*`.
  - Touch targets are 44px or larger on kitchen and orders.
- **Guest QR menu (`/{slug}/dining/t/{token}`):** Woven Ledger world.
  - Literata / Inter / JetBrains Mono, ruled rows, hotel accent.
  - Reuse the `.order-*` and `.storefront-menu*` classes in `(guest)/woven-ledger.css`, `StorefrontNav`, and the photo lightbox.
  - Add a short "Dining at the table" entry to `DESIGN.md`, plus `PRODUCT.md`, when it ships.

## Phase 1: Bug fixes and layout foundation (no migration)

1. **Dialog close bug.** Replace `$effect`-on-`form` closing with closing in the `use:enhance` result callback (`({ result }) => result.type === 'success' && close()`).
   - Files: `floor-plan/+page.svelte` (sheet), `addons/+page.svelte` (group and addon dialogs).
   - Mirror the pattern in `menu/+page.svelte`. Toasts stay in a form-reading effect, guarded so they fire once per submission.
   - Audit the remaining dining pages for the same pattern.
2. **Sheet width.** In `src/lib/components/ui/sheet/sheet-content.svelte`, change the right-side default to a same-variant class, so `tailwind-merge` lets callers override it.
   - Check the other sheets that pass `sm:max-w-*`: `thread-sheet`, `reservations`, `front-desk` (x2), `hr/schedule`, `availability-calendar-sheet`.
3. **Poll resets.**
   - Key the `new-order-sheet` reset on the `open` false→true transition only, using `untrack` for everything else.
   - Make `thread-sheet` load once per `order.id`, with no `invalidate` inside the effect.
   - Reset `refund-dialog` on `open`.
4. **Dining layout (`management/dining/+layout.svelte`).**
   - Make the tab nav `overflow-x-auto` with `shrink-0` tabs, and mark the active tab with `aria-current`.
   - Unify page width: one shared container (`max-w-7xl`), with narrower prose inside.
5. **New-order sheet redesign (`orders/new-order-sheet.svelte`).**
   - Use a container-query layout:
     - Below about 720px, `Tabs` for Menu | Order with a sticky bottom bar ("3 items · ₱540 · View order").
     - Above that, menu on the left and a cart rail on the right with a sticky footer.
   - Show dish photos (`imageUrl` is already loaded). Truncate long table labels.
   - Pin the "Add to order" button inside the add-on panel.
   - Pad the header so the close button does not overlap the title.

## Phase 2: Per-station kitchen flow and timers (migration 0074)

**Schema (`schema/dining.ts`):**
- `dining_order_items`: add `startedAt`, `readyAt` (nullable timestamptz).
- `dining_stations`: add `targetMinutes` (default 10, nullable) for the late threshold.

**Logic (`src/lib/dining-orders.ts`, `src/lib/server/dining-orders.ts`):**
- Add `setStationStatus({ hotelId, orderId, stationName|null, to: 'preparing'|'ready' })`. It sets the timestamps on that station's items, with a row lock like `setDiningOrderStatus`.
  - Any station started → order `preparing`.
  - **All items ready → order `ready`** (derived), and the guest "ready" email hook fires only at that point (`dining-orders.ts:344`).
  - Items with no station count as their own "Unassigned" group, so they cannot block an order.
- Expose `stationId`, `startedAt` and `readyAt` on `OrderView.items`.
- The kitchen `advance` action takes an optional `station`. With the "All" filter it advances every station.

**Kitchen board UI (`kitchen/+page.svelte`):**
- Each ticket shows a large **"waiting" timer** since the order was placed, e.g. `34 min` or `1h 05m`. It is monospace and tabular.
- Under it, one row per station:
  - `Kitchen · cooking 12m`
  - `Bar · ready ✓ 2m ago`
  - `Pastry · not started`
- Each row has its own Start and Ready button. The old whole-order button remains only for the "All" view.
- A progress bar against the station target (default warn 10, late 20, configurable on the Stations page):
  - **On time:** neutral.
  - **Warning:** `--warning` with a clock icon and the text "Slow".
  - **Late:** `--danger` with a triangle icon and the text "Late".
- Sort oldest first.
- The "Ready, waiting to be served" strip shows table, items and "ready 4m ago". It turns warning after 3 minutes, because food is getting cold at the pass.
- Use `serverNow` to correct client clock skew.
- The Orders board cards show the same waiting time and a per-station ready summary ("Bar ✓ · Kitchen cooking").

## Phase 3: Areas, table check, close table (migration 0074)

**Schema:**
- `dining_areas(id, hotelId, diningItemId, name, sortOrder)`. Unique on `(diningItemId, name)`.
- `dining_tables.areaId` replaces the free-text `area`. The migration creates an area per distinct existing label, and a "Main" area for tables with none.
- `dining_table_checks(id, hotelId, tableId, diningItemId, reservationId?, status 'open'|'closed', openedAt, billRequestedAt?, closedAt, closedByUserId)`.
- `dining_orders.checkId` (nullable FK).
- Index on `(tableId) WHERE status='open'`, so there is at most one open check per table.
- `dining_tables.qrToken` (unique, random, rotatable), used in Phase 4.

**Server (new `src/lib/server/dining-checks.ts`):**
- `getOrOpenCheck(tableId)`. `createDiningOrder` attaches a dine-in order with a `tableId` to the table's open check, opening one if needed. If a seated reservation holds the table, the check links to it.
- `settleCheck({ checkId, method, ... })` loops the check's unpaid, non-cancelled orders and pays or room-charges each.
  - Reuse `payDiningOrder` (`dining-orders.ts:390`) and `chargeDiningOrderToRoom` (`dining-room-charge.ts:82`).
  - Refactor them to accept an optional transaction so the whole settle is atomic. Each order keeps its own receipt.
  - Refuse if any order is not yet `served`, unless it is cancelled.
- `closeCheck` requires every order served and paid (or cancelled). It sets `closedAt`, completes the linked `seated` reservation, and the table becomes Free.
- `forceClearCheck` (manager only, audited) cancels unserved unpaid orders and closes the check.
- `requestBill` sets `billRequestedAt`.
- `deleteTable` is also blocked while a check is open.

**Floor plan UI (`floor-plan/+page.svelte`):**
- Area tabs, each with its own canvas. Areas are managed in a small dialog: create, rename, reorder, delete when empty. Examples: Public Area, VIP Room, Deluxe Suite, 2nd Floor, 3rd Floor.
- Table states derive from the open check and reservations:
  - **Free**
  - **Reserved**
  - **Occupied**
  - **Needs payment** (all served, check unpaid, or bill requested)
- The table popover shows the check: orders with status chips, running total, and **Settle & close**. A manager also sees Force clear.
- A table card shows time seated.
- The Orders board groups by table: a "Table 4 · 3 orders · ₱1,240" header with a Settle button. Takeaway orders stay separate.

## Phase 4: QR table ordering and guest menu

- **Dependency:** add the `qrcode` package, generating SVG server-side (none exists today).
- **Management QR tab:** a "QR codes" action on the floor plan.
  - Per-table preview, copy link, and **Rotate code**.
  - A printable A4 sheet of table tents (`floor-plan/qr/print`): hotel name, area, table name, and QR.
- **Guest route `/{slug}/dining/t/{token}`** (Woven Ledger):
  - Shows the venue and table, e.g. "Table 4 · Terrace".
  - Category chips (SOUP, DESSERTS, BEVERAGE, COFFEE…) with a ruled list. Each dish has a photo, name, description and mono price. Sold-out items are disabled.
  - Add-on choices appear inline.
  - A floating cart pill opens the cart (qty steppers, notes, total). **Send to kitchen** places the order.
  - After sending, the guest sees the table's rounds with status, can order another round, and can **Request the bill**.
  - Reuse `createDiningOrder`, the add-on rules, and the price helpers.
  - Guard with the existing honeypot, a new rate limit per token, the venue being open, and an active table.
- **Staff accept:** add enum value `pending_acceptance` to `dining_order_status`.
  - QR orders start there. Staff **Accept** (→ `new`) or **Decline** with a reason, from a new "Awaiting acceptance" panel on the Orders board and a badge in the dining nav.
  - Accepting opens or joins the table's check. Update `ORDER_TRANSITIONS`.
  - The guest tracker shows "Waiting for staff to confirm".
- **Menu authoring (images and categories):** the item dialog already has a photo upload.
  - Add a "no photo" badge and a missing-photo filter.
  - Add a "Starter categories" button that seeds Soup, Appetizers, Mains, Desserts, Beverages, Coffee.

## Phase 5: Tab-by-tab UI/UX polish

- Add shadcn-svelte `card`, `alert`, `scroll-area` and an empty-state helper via the project CLI. The repeated hand-built `rounded-xl border` blocks use them.
- Replace the raw `<button>` rows and the hand-made `role="tablist"` links (menu, addons) with `Tabs`.
- Use the `--warning` token in place of raw `amber-*`.
- Orders: bigger touch targets on card actions.
- Reservations and Sales: tables scroll horizontally instead of clipping (`overflow-x-auto`).
- Add-ons: stack the add-option row on phones.
- Settings: use styled file inputs, and make photo-remove visible on touch.
- Keep `DESIGN.md` and `PRODUCT.md` current for the guest QR surface.

## Critical files

- `src/lib/server/db/schema/dining.ts`, plus new migration `drizzle/0074_*.sql`
- `src/lib/server/dining-orders.ts`, `src/lib/dining-orders.ts`, new `src/lib/server/dining-checks.ts`
- `src/lib/server/dining-room-charge.ts`
- `src/routes/[hotel]/management/dining/{kitchen,orders,floor-plan,addons,stations,menu}/`
- `src/lib/components/ui/sheet/sheet-content.svelte`
- `src/routes/[hotel]/(guest)/dining/t/[token]/` (new), `woven-ledger.css`

## Verification

- `pnpm check`, then `pnpm test` (live-DB tests skip without a DB). Add tests:
  - Station ready: the order becomes `ready` only when every station is done, and the email fires once.
  - Check: orders on one table share a check, settle pays all, close frees the table and completes the reservation, and force clear is manager-only.
  - QR: an invalid or rotated token returns 404, QR orders are `pending_acceptance`, and accept moves them to `new`.
- Run the app and check in the browser:
  - Add table T1, then T2 and T3, without the sheet closing. Do the same for add-ons.
  - New-order sheet at 390px, 768px and 1280px: cart reachable, no overlap.
  - Kitchen: one order with Kitchen and Bar items. Mark Bar ready, then Kitchen. Timer colours show an icon and text. Verify `1h 05m` formatting.
  - Create Public Area, VIP Room and 2nd Floor, then place tables in each.
  - Print the QR sheet, scan it on a phone, order two rounds, accept them on the board, cook per station, request the bill, then **Settle & close** and confirm the table goes Free.
  - Leave the new-order sheet open for over 20 seconds and confirm the cart survives the poll.
