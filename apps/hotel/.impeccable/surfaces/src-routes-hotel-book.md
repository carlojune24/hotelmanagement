---
version: 1
slug: "src-routes-hotel-book"
primary_target: "src/routes/[hotel]/book"
related_targets: []
---

## Scope & Visitor Mode

Public guest booking flow at `/{slug}/book...`. Restructured this pass around acaciahotelsdavao.com's information architecture (confirmed scope, not a guess). Persuade mode: the bare `/{slug}/book` storefront (running-head nav + breadcrumbs, hero, bare dates+promo search dock, About/Rooms & Rates (undated only now)/Function Hall/Gallery/Reviews sections, footer, floating invoice — Function Hall only), and `/book/rooms/[roomTypeId]` (a real page, own URL — superseded the earlier Room Details Dialog). Operate mode: a real 5-step wizard — `dates` → `rooms` → `details` → `review/[orderId]` → PayMongo redirect → `confirmation/[orderId]` — with a horizontal step tracker (replaced an earlier vertical left-rail) and a Booking Summary Sidebar (steps 2-3 only). One committed world (Woven Ledger, see DESIGN.md) spans all of it — Acacia's page *shape* was adopted, never its visual skin.

## Audience, Job, Proof

Guests booking a specific Philippine hotel directly. On the storefront: believe this is a real, specific hotel within seconds, then browse room types and (if the hotel has one) its function hall, add either or both to one running invoice, and check out once in a single PayMongo session. Proof is the hotel's own real data — including, now, real staff-moderated guest reviews (never fabricated; the section simply doesn't render with zero approved ones).

## Chosen Direction & Memorable Moment

Woven Ledger, extended across five passes now: (1) the original storefront redesign, (2) an OTA-reference-driven pass, (3) Function Hall, a unified floating invoice/cart, and real reviews, (4) a Room Details dialog, (5) this pass — restructured around Acacia's booking-flow shape, which superseded (4) and part of (2)'s search dock. The confirmation ticket remains the flow's signature moment. The Flat Ledger Rule now has zero modal exceptions left in the guest flow (the dialog from pass 4 became a real page).

## Scope & Boundaries

New this pass: `/book/dates` (Step 1, occupancy collection — the only place in the flow it happens now), `/book/rooms` (Step 2, the dated results page + a per-card Rooms stepper + `booking-summary-sidebar.svelte`), `/book/rooms/[roomTypeId]` (the room detail page, superseding `room-details-dialog.svelte` — deleted), a horizontal step tracker in `+layout.svelte` (superseding the vertical left-rail), and a bare homepage search dock (dates + promo code only — the Rooms & Guests popover from pass 4/earlier this session was removed, not relocated). `$lib/cart-display.ts` extracted the `itemLabel`/`itemDetail` logic previously duplicated between the Floating Invoice and the Details page's inline bill (now removed — the sidebar owns that job on steps 2-3; Review keeps its own DB-backed bill). Two new additive helpers in `lib/server/availability.ts`: `getAvailableRoomType`/`getBrowsableRoomType` (both `.find()` wrappers over the existing list functions, not new filter parameters — kept the diff off payment-adjacent code). Two new optional `branding` fields (`checkInPolicy`/`checkOutPolicy`, jsonb, no migration) for the room detail page's policy block — no staff settings UI yet, so they simply don't render until set by hand in the DB or a future settings page.

**Every relative redirect/link introduced this pass was verified with Node's `URL` class before shipping**, not eyeballed — the exact bug class (`../foo` resolving one directory too far/short) was caught and fixed three times in the room-count pass earlier this session and twice more while building this restructure (a homepage-to-`book/rooms` form action, a room-detail-page Book Now link). Any future new page in this tree should do the same check rather than assume.

Previous pass (Function Hall / floating invoice / reviews): `#function-hall` section (hall row + live-quote reservation mini-form via `/book/api/hall-quote`), `.storefront-invoice` floating cart (`lib/cart.svelte.ts`, Svelte-context + sessionStorage), `#reviews` section, and `book/leave-review/[bookingId]` (guest review submission, gated on `booking.status === 'checked_out'` and the parent order's access token). Staff additions: `(staff)/settings/function-halls` (CRUD, mirrors room-types pattern) and `(staff)/reviews` (moderation queue, Pending/Approved/Rejected tabs) — both plain staff-shell UI, outside the Woven Ledger world.

**Architecture note (not a DESIGN.md concern but load-bearing for this surface):** `bookings`/`payments` were restructured onto a new top-level `orders` table so one PayMongo checkout can cover a room stay and/or a hall reservation together — `details`'s `createOrder` action now takes a whole cart (Zod discriminated union, sorted advisory locks per product touched, re-verify + re-price every line server-side) instead of one roomTypeId/ratePlanId pair; the webhook fans one paid session out to confirm every pending `bookings`/`hallBookings` row under the order. Verified end-to-end against the real dev DB and PayMongo test-mode API for both a room-only order and a combined room+hall order, including webhook idempotency.

## States & Ranges

Same as before, plus: an empty cart on `details` shows a "your invoice is empty" state with a link back to the storefront rather than crashing. A function hall with no active row skips its storefront section and nav link entirely. A room type/hall photo that 404s still hides itself via `onerror` (unchanged pattern). A review page visited before `checked_out` shows a friendly "not yet" message, not a 404; one already submitted shows its moderation status instead of the form. On the Room Detail Page, a room type with zero photos, no amenities configured, or no accessibility flags simply omits that block — verified against the real dev DB's own sparse seed data (a room type with photos but zero `room_type_amenities` rows), not just a hypothetical.

## Open Decisions for the Build

- Fees/VAT are computed per cart line, not once against a merged order subtotal (`pricing.ts`'s `computeFeesAndVat`, shared by `priceStay` and the new `priceEventHall`) — an accepted v1 simplification: no hotel today has a `taxesFees` row that would double-charge across a room+hall order in practice. Documented in `orders.ts` and `pricing.ts`.
- Reviews have no email-delivery discovery path (no mailer exists anywhere in this codebase) — the "Leave a review" CTA surfaces on the guest's own bookmarked confirmation page once `checked_out`, which is also the only way this pass can be exercised end-to-end today, since front-desk check-out UI is still TODO (tested here via a manual DB status flip).
- `includedServices`/`supportedEventTypes` on a function hall are hotel-authored free text (comma-separated in the staff form, `text[]` columns), not tied to the amenities catalogue — a hall's event types vary too much per property for a fixed enum.
