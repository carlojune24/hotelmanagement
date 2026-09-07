# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences on this app:

- **Guests** (public, unauthenticated) — book a room at one specific hotel via `/{slug}/book`. Mixed leisure and corporate/OTA-style travelers: leisure guests comparing photos/price/room type on mobile, and corporate or agent-style bookers who need to compare rate plans (inclusions, cancellation terms, refundable vs. promo) more deliberately, sometimes multiple rooms. Philippine market.
- **Staff** (authenticated) — hotel admins, front desk, housekeeping, accountants, HR, and platform admins, working the operational side (`/{slug}/dashboard`, `/{slug}/settings/...`, `/admin`). Out of scope for this booking-surface pass except as the ones who configure what guests see (room types, rates, photos, branding).

## Product Purpose

`mmhotel` is a multi-hotel management + online booking platform for independently operated small-to-mid Philippine hotels/resorts. One deployment serves many properties (path-based tenancy, `/{slug}/…`); each hotel's public booking page is where a guest picks dates, sees available room types and rate plans, and pays. Success = a guest completes a real reservation (confirmed + paid) without staff intervention.

## Positioning

Not a marketplace/OTA (no cross-hotel search or commission model) and not a bare booking-engine widget bolted onto a hotel's existing site — `mmhotel` **is** the hotel's booking site at its own path, carrying that hotel's own identity, while the backend (rates, inventory, front desk, folio, payroll, accounting) is shared multi-tenant infrastructure the hotel doesn't have to run itself.

## Operating Context

- Guest arrives at `/{slug}/book` (redirected there automatically for non-staff visitors), searches by date range + occupancy, sees available room types with rate-plan price breakdowns (`lib/server/availability.ts`, `lib/server/pricing.ts` already compute this server-side), fills guest details, and pays.
- Payment is **PayMongo hosted Checkout Session only** — the guest is redirected off-site to PayMongo to pay and returns to a success/cancel URL. There is no embedded card form; design the flow around leave-and-return, not an inline payment step.
- Room/hotel photos are stored as URL strings in jsonb columns (`room_types.photos`, `rooms.photos`, `function_halls.photos`, `hotels.config.branding.{logoUrl,heroImageUrl,galleryImages}`) — the shape doesn't care whether that string is an external link or a locally-uploaded file's served path, so nothing consuming a photo needs to know which. **Branding images and function hall photos** have a real upload path: `lib/server/uploads.ts` writes to local disk (`UPLOADS_DIR`, default `<cwd>/uploads`) since the app runs on `adapter-node` as a persistent server, served back via `routes/uploads/[hotelId]/[filename]`; swap that one module for an object-store client if this ever moves to serverless/ephemeral hosting. **Room-type photos** (`room_types.photos`) upload too, with an explicit Cover/Gallery choice per upload (uploading a new cover demotes whichever photo currently holds that tag, so there's always exactly one). **Individual room-unit photos** (`rooms.photos`, on `/settings/rooms/units/[roomId]`) are the one remaining URL-only page — same `uploads.ts` infra would cover it the same way. Either way, a hotel may have partial or zero photos at launch; the page must degrade gracefully (placeholder/no-photo states are a real, expected case, not just an empty-state edge case).
- Currency is always PHP, prices are computed and stored in centavos; VAT is a per-hotel configurable rate (default 12%) plus optional additional taxes/fees (reservation fee, resort fee) — the price breakdown the guest sees must reconcile with what `pricing.ts` actually computes.
- A hotel's amenities (schema already exists: `amenities`/`hotel_amenities`/`room_type_amenities`, with `is_highlighted` flags) are informational only at this stage — not separately sellable/bookable (that's Phase 2's `amenity_items`).

## Capabilities and Constraints

- **Per-hotel branding is a confirmed requirement, not yet implemented.** `hotels.config` (jsonb, free-form) exists but currently carries no branding fields, and there is no hotel-admin UI to set them. This booking-surface work is expected to define what "branding" means concretely (logo, brand/accent color, hero image, short tagline are the likely candidates) and add the schema + settings UI alongside the guest-facing page — not just the guest page in isolation.
- Booking/guest/payment schema exists and is wired end-to-end: `guests`, `orders` (the actual checkout object — one PayMongo session, one guest, one bill), `bookings` (room stays) and `hallBookings` (function hall reservations) both hang off an `orders` row via `orderId`, `payments` (idempotent on PayMongo's event id). A single order can carry a room stay and/or a function hall reservation together, added to a client-side floating-invoice cart (`lib/cart.svelte.ts`) and paid in one PayMongo Checkout Session whose webhook fans confirmation out to every line. `folios`/`official_receipts` remain TODO per `docs/TODO.md` — front-desk/accounting features, not the guest checkout path itself.
- Multi-property: the same booking page template serves every hotel in the system, parameterized by that hotel's own data (name, rooms, rates, photos, and once added, branding) — it must not be hand-tuned per hotel in code.
- Existing staff-app visual system (`apps/hotel/src/app.css`: Tailwind v4 + shadcn-svelte tokens, oklch palette, light/dark via `.dark`) is the operate-mode staff UI, not necessarily the guest-facing identity — the guest booking page is a Persuade/Operate hybrid (browse+decide, then complete a task) and may warrant its own visual treatment per hotel, distinct from the internal staff shell.
- Terminology: "hotel" = a property (tenant); "room type" = sellable product (e.g. "Deluxe Twin"); "room" = physical unit; "rate plan" = a priced offer on a room type (e.g. "Standard Rate", "Non-refundable Promo") with its own inclusions/cancellation policy.

## Brand Commitments

Product name is "MM Hotel" (parent platform) — individual hotels are the ones with guest-facing brand identity, not the platform itself. No other confirmed voice/asset commitments yet.

## Evidence on Hand

No real hotel photos, logos, or copy on hand yet — the demo/seed hotel (`hotel1`) has no photos populated. Treat photo-heavy layouts as needing to work with placeholder or zero photos; do not fabricate real-looking testimonials, guest counts, or review scores. (A real, staff-moderated review pipeline exists now — `reviews`, gated on a completed stay, approved before going public — this principle is about never faking data client-side, not a ban on the feature itself.)

## Product Principles

1. The booking page is the hotel's storefront, not the platform's — design so per-hotel identity (once branding fields exist) reads as *that hotel's* site, with `mmhotel` invisible as a brand to the guest.
2. Price transparency: whatever the guest is shown must match what `pricing.ts` actually computes (nightly rate, weekend/seasonal overrides, extra person/child/bed fees, taxes/fees, VAT) — no simplified marketing number that diverges from the real bill.
3. Graceful with partial data: a hotel with zero photos, one room type, or no branding set should still look intentional, not broken.
4. PayMongo's redirect is a trust moment, not just a technical handoff — the guest is leaving the site to pay; design the pre-redirect summary and the return/confirmation state carefully.
5. One template, many hotels: every visual decision must work for a 6-room boutique inn and a 60-room resort alike, using only per-hotel data.

## Accessibility & Inclusion

No product-specific requirement established yet beyond general web accessibility (guests may book on low-end Android devices over mobile data — treat performance/lightweight-ness as an inclusion concern, not just aesthetics).
