<!-- AS-BUILT: the guest booking flow (search, results, details, review, confirmation) is implemented under src/routes/[hotel]/book/ per this file. Tokens and components below reflect the shipped implementation, not a seed. -->

---
name: MM Hotel — Guest Booking (Woven Ledger)
description: A hotel's own direct-booking storefront, styled as a textile-bound guest register — each property's accent color becomes a real woven pattern, not a swatch.
typography:
  display:
    fontFamily: "Literata Variable, Georgia, serif"
    fontWeight: 500
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter Variable, sans-serif"
    fontWeight: 400
    lineHeight: 1.55
  data:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontWeight: 500
    letterSpacing: "0.01em"
rounded:
  sm: "4px"
  md: "10px"
  lg: "18px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "32px"
  xl: "56px"
---

# Design System: MM Hotel — Guest Booking (Woven Ledger)

**Scope: the public, unauthenticated `/{slug}/…` guest-facing booking surface only** — search, results, guest details, review, PayMongo redirect, confirmation. It is a deliberately separate world from the authenticated staff app (`(staff)` routes), which keeps its existing neutral shadcn/oklch operate-mode theme untouched. A staff route never inherits this file; a guest route never inherits the staff theme.

## Overview

**Creative North Star: "The Textile-Bound Guest Register"**

Every independent Philippine hotel used to keep one physical object at its front desk: a bound ledger where a guest's stay was written into a ruled page, and where the cover itself — often a woven textile, inabel or t'nalak-derived geometry — was the one piece of the hotel's identity that never changed. This world rebuilds that object for the web: a calm, warm, ruled-and-registered interface where the hotel's *own* accent color is never just a swatch on a button — it is spun into an actual repeating woven pattern that binds the hero, the section dividers, and the confirmation itself, the way a textile cover binds a ledger's pages.

This is explicitly not an OTA card grid. There is no star-rating chrome, no "Genius" badge, no dense thumbnail carousel competing for attention. It is one hotel's own storefront, and it reads that way: fewer, larger, ruled compositions; tabular honesty about price; a woven frame instead of a stock-photo hero treatment.

Two registers coexist deliberately: the *ledger* register (serif display, ruled rows, warm paper) for browsing and deciding, and the *manifest* register (monospace, tabular, high-precision) for anything numeric — dates, nights, prices, confirmation codes. Guests read the story in Literata and verify the bill in JetBrains Mono; they should never be confused about which one they're looking at.

**Key characteristics:**
- Per-hotel accent color is rendered as a real woven geometric pattern (a repeating diamond step-weave), never used only as a flat swatch.
- Warm paper-toned neutrals, distinct from the staff app's cool oklch grays — this world is never mistaken for the staff shell.
- Ruled horizontal rules (like ledger baselines) organize rhythm instead of boxed cards.
- All money, dates, and codes render in the monospace "manifest" register, right-aligned like a ledger's number column.
- The confirmation screen is a literal bordered ticket/stub, not a generic "success" toast.

## Colors

Ink/rule/danger are fixed and hotel-agnostic. Accent **and** the page background ("paper") are **per-hotel and computed at render time** from values the hotel admin picks (`hotels.config.branding.accentColor`/`paperColor`) — DESIGN.md fixes the *system*, not the hex. **Default accent (unset hotels): `#836819`, a deep antique gold** (`lib/server/branding.ts`'s `DEFAULT_ACCENT_COLOR`) — chosen dark enough that `--ledger-paper` button text on a flat accent fill still clears ~4.7:1 contrast. **Default paper (unset hotels): `#ffffff`, pure white** (`DEFAULT_PAPER_COLOR`).

Both pickers in `(staff)/settings/branding` share the same mechanic — a curated palette of named hues plus a continuous hue slider, both locked to one fixed saturation/lightness recipe rather than a bare color input — but the two recipes are tuned for opposite jobs. Accent (`ACCENT_PALETTE`: Gold, Terracotta, Wine, Plum, Navy, Teal, Forest, Olive; `ACCENT_SATURATION`/`ACCENT_LIGHTNESS`, 68%/31%) is locked *dark*, so every reachable pick clears the ~4.7:1 button-text contrast bar the same way `DEFAULT_ACCENT_COLOR` does. Paper (`PAPER_PALETTE`: Cream, Peach, Blush, Lilac, Sky, Mint, Sage, Moss; `PAPER_SATURATION`/`PAPER_LIGHTNESS`, 3%/98%) is locked *light and barely saturated* instead, so every reachable pick stays close enough to white that the fixed dark `--ledger-ink` body text and `--ledger-paper`-colored button labels never need their own contrast check — a hotel gets "their" background mood (a warm cream vs. a cool sky tint) without ever risking an unreadable page. Both pickers keep a plain hex field underneath for an exact manual value — the one path on either picker that can still produce an unintended result, same trade-off accepted for accent since this control existed.

### Primary (per-hotel, computed)
- **Hotel accent** (`--hotel-accent`, set inline per request from `branding.accentColor`, oklch or hex as stored): drives the woven pattern's dark thread, the primary CTA fill, active/focus states, and the confirmation ticket border. Never hardcode a specific hotel's accent into a shared component.
- **Accent thread — light** (`color-mix(in oklch, var(--hotel-accent) 55%, var(--ledger-paper))`): the pattern's light thread and hover/tint surfaces.
- **Accent thread — deep** (`color-mix(in oklch, var(--hotel-accent) 70%, black)`): pressed/active states, ticket border stroke.
- **Section headline color** (`.storefront-section-title`, `color: var(--hotel-accent-deep)`): every top-of-section heading — About, Amenities, Rooms & Rates, Function Hall, Gallery, Reviews on the homepage, plus the page title on Dining/Meetings & Events/Contact — carries the hotel's own accent instead of plain ink, so the page's chapter breaks pick up some of the hotel's own color the way the woven pattern and buttons already do. Deep, not the raw accent, since the flat accent is tuned for fills, not guaranteed legible as body-headline-sized text on `--ledger-paper`. Deliberately **not** applied to individual content-item names (a specific room card, dining venue, or function hall) — this class marks page chrome, not content, so a room named "Ocean Suite" stays plain ink like the rest of its own description.

### Neutral
- **Ledger Paper** (`--ledger-paper`, per-hotel, set inline from `branding.paperColor`, default pure white): base surface — every other page/section background, plus the text color for anything filled with the accent (`.ledger-btn-primary`, the confirmation ticket's outer frame). Computed server-side in `book/+layout.server.ts`'s `theme.paper`, same mechanism as `theme.accent`.
- **Ledger Paper Deep** (`--ledger-paper-2`, per-hotel, `theme.paperDeep`): section bands, table zebra rows — computed as `darken(paper, 0.03)` (`lib/woven-pattern.ts`'s existing hex-mix helper, the same one that derives `accentLight`/`accentDeep`) so it stays a shade deeper than *whatever* paper tone the hotel picked, not a fixed tint that could clash with it.
- **Ledger Ink** (`--ledger-ink: oklch(0.26 0.02 60)`): primary text — warm near-black, not pure gray.
- **Ledger Ink Muted** (`--ledger-ink-muted: oklch(0.5 0.018 60)`): secondary text, captions, inclusions lists.
- **Ledger Rule** (`--ledger-rule: oklch(0.82 0.02 65)`): the ruled horizontal lines themselves — always a hairline, never a boxed border around content.

### Named Rules
**The Woven, Not Flat Rule.** Any surface region large enough to read as "branded" (hero band, section divider, ticket border) renders the accent as the woven pattern at reduced opacity over Ledger Paper — never as a flat accent-colored rectangle. Small UI (buttons, links, focus rings) may use the flat accent directly.

**The One Thread Rule.** Only one hotel's accent is ever on screen at a time — this is a single-tenant storefront per request, not a portfolio view. Never render two different hotels' accents in the same viewport.

## Typography

**Display Font:** per-hotel selectable, Literata Variable (serif, with Georgia fallback) by default. A hotel can instead choose Playfair Display, Fraunces, or Cormorant Garamond — four curated options in `$lib/branding.ts`'s `DISPLAY_FONTS`, each a self-hosted `@fontsource-variable/*` package (no Google Fonts CDN call at request time, consistent with how Literata/Inter/JetBrains Mono already ship). Picked in `(staff)/settings/branding` (a 2×2 grid of live "Aa" previews, one per option), resolved into `--ledger-font-display` inline per request in `book/+layout.svelte`'s `rootStyle` — every `h1`/`h2`/`h3`/`.ledger-display` rule reads that variable rather than a hardcoded font-family, so the choice reaches the whole storefront (hero, room names, room-photo initial mark, confirmation ticket) from one place.
**Body Font:** Inter Variable (sans, with system-ui fallback) — already the project's font, reused here for continuity between guest and staff apps at the sentence level. Fixed, not hotel-selectable.
**Data/Mono Font:** JetBrains Mono Variable — every date, night count, price, and confirmation/booking code. Fixed, not hotel-selectable — Body and Data stay put deliberately, so a hotel's Display pick can't break the Two-Register Rule's contrast (see below) the way changing all three at once could.

**Character:** Literata carries the register's warmth and narrative weight (hotel name, room type names, section headers); Inter stays invisible and legible for body copy, labels, and form fields; JetBrains Mono is the "verify the numbers" voice — it never appears in prose, only in tabular or single-value data contexts.

### Hierarchy
- **Display** (Literata, 500, `clamp(2rem, 5vw, 3.25rem)`, 1.05): hotel name in the hero, confirmation headline.
- **Headline** (Literata, 500, `1.5rem–1.875rem`, 1.15): room type names, section titles ("Choose your room", "Review your stay").
- **Title** (Inter, 600, `1rem–1.125rem`, 1.3): rate plan names, form section labels.
- **Body** (Inter, 400, `0.9375rem`, 1.55, max 68ch): descriptions, inclusions, policy text.
- **Label** (Inter, 500, `0.75rem`, letter-spacing `0.04em`, uppercase): field labels, ledger column headers.
- **Data** (JetBrains Mono, 500, `0.9375rem–1.125rem` depending on prominence, 1.3, tabular-nums): prices, dates, nights, confirmation codes — always right-aligned when in a column.

### Named Rules
**The Two-Register Rule.** If it's a fact you'd verify against a bill or itinerary (price, date, code, quantity), it renders in JetBrains Mono. If it's a name, description, or decision, it renders in Literata or Inter. Never mix registers within one data point.

## Layout

Single-column, ledger-page rhythm rather than a card grid: content sits inside a constrained reading measure (`max-w-3xl` for narrative/forms, `max-w-5xl` for the results ledger, `72rem`/6xl for the storefront's wider marketing sections) with generous top margin above each section heading and tighter margin below it (headings own the space above them, per a ledger page's section breaks). Room-type results render as **ruled rows** (`.ledger-room-row`), each row a horizontal band separated by a `--ledger-rule` hairline, not a bordered card — a real photo panel on the left (see Storefront) marks each row as belonging to this hotel. Rate plans nest as a sub-ledger within an expanded room-type row, indented and set in the smaller Title/Data sizes.

Responsive: the ruled-row layout collapses gracefully to full-width stacked rows on mobile (the dominant guest device per PRODUCT.md); the woven left-edge tab becomes a full-width top band instead of disappearing, so branding survives on small screens. The booking wizard (Dates → Select Rooms & Rates → Guest Information → Review & Payment → Confirmation, five real steps) is a linear vertical scroll on mobile and a **horizontal step tracker** on desktop ≥1024px (`.ledger-stepper-horizontal`, circular numbered nodes joined by a `--ledger-rule` hairline — replaced an earlier vertical left-rail this pass, same active/done tokens, new geometry), never a modal wizard — **except the bare homepage**, which is the storefront itself, not a task screen (see Storefront below): it runs no step chrome or step tracker at all, and neither does the Room Detail Page (see below), which is its own Persuade-mode surface reached before or outside the wizard proper.

## Storefront (the bare search page)

`/{slug}/book` is a hotel's homepage, not step 1 of a wizard — a guest arrives having chosen nothing yet, so it runs Persuade mode in full: a running-head nav, a full-bleed hero, and marketing sections, all still inside the Woven Ledger vocabulary (same three type registers, same ruled/woven/flat rules). The instant "Check Availability" or a room's "Book Now" moves the guest into the booking wizard (`dates` → `rooms` → `details` → `review` → `confirmation`), the storefront chrome disappears and the Operate-mode step chrome (above) takes over — the two never show at once. This pass restructured the flow around acaciahotelsdavao.com's information architecture (a real reference property, per the same "study a reference site" precedent as the earlier OTA-driven pass) — its page *shape* was adopted (dedicated dates/results/detail pages, a horizontal step tracker, a booking-summary sidebar), never its visual skin, which stays Woven Ledger throughout.

- **Running-head nav** (`.storefront-nav`): sticky, `--ledger-paper` background, single hairline rule underneath — a ledger's title line, not an app bar. Hotel name/logo on the left (`.storefront-nav-brand`, logo at `h-14`/56px, name at `text-xl` — sized up across two passes after an earlier, smaller pairing read as an afterthought; `.storefront-nav-inner`'s own vertical padding was trimmed in step so the bar grows with the logo without going oversized); anchor links (About, Rooms & Rates, Gallery) at sentence weight, ledger-ink-muted, gaining a gold underline on hover; one `ledger-btn-primary` "Reserve" action on the right, jumping to the search dock. No shadow, ever. An earlier `.storefront-breadcrumbs` line (Home › Philippines › city › hotel) that rode below the nav row was removed outright this pass — it added a second running head this storefront never asked for and Acacia's own nav doesn't carry one either.

  **Transparent-over-hero phase** (`.storefront-nav.is-transparent`, homepage only, and only when the hotel has a `heroVideoUrl` or `heroImageUrl`): the nav starts transparent with light text sitting directly over the hero media, then turns solid once `window.scrollY` passes a small fixed threshold (48px) — per Acacia's own homepage behavior. "Reserve" is untouched either way, since a solid accent fill already reads over a photo. The nav stays `position: sticky` throughout — the overlap is achieved by pulling `.storefront-hero.has-media` up on a negative top margin equal to the transparent nav's own height, never by switching to `fixed`/`absolute`. Every other page (Dining, Meetings & Events, Contact, Room Detail) leaves the `transparentOverHero` prop unset and gets the plain solid nav unchanged. The light-text override targets `.storefront-nav-brand-name` directly (the `<span class="ledger-display">` carrying the hotel name), not just its `.storefront-nav-brand` wrapper — a color set only on the wrapper doesn't reach a child that already carries its own direct color rule (`.ledger-display`'s own `color: var(--ledger-ink)`), since a more specific rule matching the element itself wins over an inherited one regardless of the ancestor selector's specificity; this was the exact bug caught and fixed this pass (hotel name staying dark over the transparent nav instead of turning white).
- **Hero** (`.storefront-hero`): **full-page** (`min-height: 100svh`, with a `100vh` fallback) — matches Acacia's own near-full-viewport banner, a deliberate change from an earlier content-sized hero. Backdrop precedence: a hotel's `branding.heroVideoUrl` (muted, looped, autoplaying, `playsinline`, using `heroImageUrl` as its `poster` for a fast first paint) wins when set; otherwise the single full-bleed `heroImageUrl` photo (`.storefront-hero-photo`, `object-fit: cover` — an earlier multi-image collage was tried and replaced in an earlier pass); with neither set, the hero falls back to `.ledger-woven-band` at full strength and stays sized to its content rather than stretching to full height, since a full-viewport flat pattern with nothing behind it would read as an empty wall, not a banner. Either media type also carries a flat `brightness-75` filter directly on the `<img>`/`<video>` element (a real `filter`, not `backdrop-filter` — that darkens what's *behind* an element, not the media itself) so the whole photo/video reads a shade darker everywhere, not just under the bottom scrim — keeps the transparent nav's light text legible even over a bright top third of the image, where the scrim alone doesn't reach. Both sit under the same bottom-anchored scrim on top of that, with the same "See the gallery" overlay button (bottom-left). Because the box is now much taller, `.storefront-hero-inner` becomes a flex column with the text/CTA block pinned to the bottom (`margin-top: auto`) — same visual position as before this pass, just at the foot of a taller hero. Text follows Acacia's own hierarchy: a small "Welcome to {hotel name}" Label-register eyebrow, then the hotel's **tagline as the Display headline** (the hotel's own name is already carried by the nav/logo above; it only becomes the headline as a fallback for a hotel that hasn't written a tagline, since a slogan can't be fabricated), then an optional "Rates from ₱X / night" Label+Data line computed from the lowest active rate plan across all room types.
- **Search dock** (`.storefront-search-dock`): deliberately bare, matching Acacia's own homepage exactly — Arrival Date, Departure Date, Promo Code (capture-and-display only; no discount engine exists), and a "Check availability" CTA, presented as a `--ledger-paper` panel with a hairline border that overlaps the hero's bottom edge on a negative margin (still no shadow, per the Flat Ledger Rule). Submits straight to `/book/rooms` (Select Rooms & Rates) — occupancy isn't collected here at all; a guest who wants a party size other than the default (2 adults) uses the Booking Summary sidebar's "Guests" Edit link once inside the wizard (see Booking Summary Sidebar below), which routes to the Dates step pre-filled. There is no Rooms & Guests popover on the homepage anymore — it was tried, then removed this pass in favor of Acacia's simpler bare form; occupancy and room-count controls now live inside the wizard itself (Dates step for occupancy, forced by `searchAvailability`'s `maxOccupancy` filter running before results exist; a per-card Rooms stepper on `/book/rooms` for room count, since that only *filters* results and never affects a rate plan's per-room price). Every price shown anywhere for a room type — the row, the Room Detail Page, `/book/rooms`'s cards, the cart — is that room's own price × the selected room count, computed by the one shared `scaleRoomPrice` helper (`$lib/pricing-utils`, capped at `MAX_ROOMS_PER_LINE`) so a displayed price and the amount actually charged can't drift apart.
- **About** (`#about`): a **two-column grid at `lg:`** (`.storefront-about-grid.has-photo`) — heading, city label, and `branding.about` copy on the left, a real property photo on the right (`branding.galleryImages[0]`, falling back to `heroImageUrl`, `object-fit: cover` in a 4:5 frame). An earlier one-column version with prose-width text and no photo read as half-empty on a wide viewport once the section had nothing to counterbalance it on the right — the grid collapses back to a single column (no `.has-photo`) only when the hotel has genuinely set no photo anywhere, never an empty placeholder box. Amenities used to live inside this section (both as a "quick strip" and the grouped list below) — both were pulled out into their own dedicated Amenities section (below) this pass, since a hotel's full facility list deserves its own chapter rather than crowding About's text column. Skips entirely if the hotel has set neither an About paragraph nor a city.
- **Amenities** (`#amenities`, only if the hotel has at least one hotel-level amenity): a standalone, full-width section — the **category-grouped** inventory (Connectivity, Services, Outdoor & View, … ; only categories a hotel actually has amenities in get a heading) laid out as a **column grid** (`.storefront-amenity-columns`, 1/2/4 columns at base/`sm:`/`lg:`), one category per column, its items listed vertically underneath the category heading — replaced an earlier stacked-rows treatment (each category full-width, items wrapping horizontally within it) that left most of the section's width empty once there were several sparse categories. The scoping is deliberate: `.storefront-amenity-columns` restyles `.storefront-amenity-list`/`.storefront-amenity-item` into a vertical column only inside this wrapper: Room Detail Page and Meetings & Events use the same base classes for their own (narrower-context) amenity lists and keep the original stacked-rows layout untouched. Category labels live client-side in `$lib/amenity-categories.ts` — a duplicate of the server-only `catalog.ts` copy, required because `lib/server/*` can't be imported from a `.svelte` file. Has its own nav link (`showAmenities`, `StorefrontNav`) alongside About/Rooms & Rates/etc. — `hotelAmenities` moved from the homepage's own load into the shared `book/+layout.server.ts` load (same reason `functionHalls`/`reviews`/`diningItems` already live there) so the nav link works from every page under `book/`, not just the homepage.
- **Rooms & Rates** (`#rooms`): a **photo-card browse grid** (`.storefront-room-grid` / `.storefront-room-card`), directly modeled on Acacia's own "Rooms & Suites" page — this replaced an earlier ruled-row (`.ledger-room-row`) treatment of the same section, deliberately, after several passes: browsing rooms and transacting on them are different jobs, and only the latter wants a ledger row. Two columns from `sm:` up, one on mobile, joined by a 3px mosaic gutter (the tight `.storefront-gallery-grid` rhythm, not the section's wide gap). Each card is **one whole link** to that room type's Room Detail Page — no nested buttons, because this screen has no "add" action at all, only navigation. Card anatomy, all overlaid on a 16:10 photo under a bottom scrim: room name in Display (light ink), a translucent hairline rule, then one row carrying an icon triplet (bed configuration, max occupancy, size in m² — each omitted when unset) on the left and, on the right, a small Data-register "from ₱X/night" plus a "Details →" affordance. The price line is a deliberate, documented deviation from Acacia's own price-free cards, kept because PRODUCT.md's guest profile explicitly includes leisure guests comparing price while browsing. Photo scales gently on hover; a photo that 404s hides itself via `onerror`, revealing the woven-pattern fill and a large initial-letter mark underneath — never a broken-image icon. **Undated-only** (indicative `listBrowsableRoomTypes` starting prices, never a real quote — the dated counterpart lives at `/book/rooms`, below).
- **Select Rooms & Rates** (`/book/rooms`, wizard step 2 — reached either from the homepage's "Check availability" or from the Dates step's "Continue"): the dated counterpart of the browse grid above, but deliberately **not** the same shape — it keeps the `.ledger-room-row` idiom (photo column, ruled row, expandable rate plans), because this is where a guest transacts rather than browses: rate plans, a room-count stepper, and per-plan cancellation terms all need a scannable row, not a photo card — real computed rate plans per `searchAvailability`, a **Rooms** stepper per card (client-side only, clamped to `min(MAX_ROOMS_PER_LINE, roomType.availableRooms)` — `searchAvailability`'s own `roomCount` filter is never re-queried per stepper change, since it only affects which types qualify, not any rate plan's per-room price), and a **cancellation badge** per rate plan (`.storefront-cancel-badge`) sourced from the plan's real `cancellationPolicies` row. Runs alongside a **Booking Summary Sidebar** (see below) that accumulates "Add to invoice" clicks. A room type highlighted via `?roomTypeId=` (arriving from its own Room Detail Page's "Book Now") auto-expands.
- **Function Hall** (`#function-hall`, only if the hotel has an active hall): a self-contained two-tone card (`.storefront-hall-card`) rather than the Rooms & Rates ruled-row idiom, since it also hosts a live reservation form. **Top zone** (white, `--ledger-paper`): photo, Literata name/description, an included-services chip row (`.storefront-hall-facts`, one generic `CircleCheckIcon` per item since `includedServices` is hotel-authored free text with no reliable per-phrase icon mapping), capacity, supported event types, and a "Starting from" Data-register price block. **Bottom zone** (`.storefront-hall-form-zone`, a shade darker — `--ledger-paper-2` — reading as one continuous panel, not a stack of separately bordered boxes floating on white): an "Event Details" heading (`CalendarDaysIcon`) over the reservation fields — event date, a native `<input type="time">` for start time (switched from a fixed-hour `<select>` this pass, both for a native time-picker look and because a `<select>`'s own browser chrome was the root cause of a real misalignment bug against the shadcn `Input`s beside it), duration, guest count, an event-type `<select>`. Every field uses `.storefront-hall-field` — a **deliberate, scoped exception to this world's usual underline field style** (a real bordered/radiused box instead, per the reference mockup this card was built against, the same kind of isolated exception the Confirmation Ticket already is to the Flat Ledger Rule) — with one explicit height/line-height/box-sizing recipe so all five sit flush on one baseline regardless of each control's native rendering. Once a quote lands (still a live, debounced round-trip to `/book/api/hall-quote` → `priceEventHall`, never priced client-side), a two-column row shows a white **Quotation Summary** panel (`ReceiptIcon` heading, the existing base/extra-hours/fees/VAT/total breakdown) beside a white **Note** callout (`InfoIcon`, the hall's own real extra-hour rate — never invented copy) — both bordered boxes popping a shade lighter against the zone's own darker fill — then a full-width **"Check Availability"** CTA. That CTA **commits and navigates**, not "add to invoice": it calls `cart.addHall(...)` (same cart every room reservation also uses, so anything else already in it survives) and immediately routes to `/book/details` — there is no intermediate cart-visit step for halls anymore, the same as clicking "Continue" in the Booking Summary Sidebar does for a room. A hall-only guest arriving at Guest Information this way still sees the full 5-step wizard tracker with Dates/Rooms & Rates rendered as "done," an accepted quirk of reusing the same generic stepper regardless of how a guest actually got there.
- **Gallery** (`#gallery`): `branding.galleryImages` (property-wide shots) plus every room type's own photos, deduped, capped at 12, laid out as an uneven contact-sheet grid (`.storefront-gallery-grid`, one wide tile every five) rather than a uniform thumbnail wall. Click opens a full-screen lightbox (a plain fixed overlay, Escape or a click to close) — no carousel library. The whole section omits itself if there are zero images to show, rather than rendering an empty grid.
- **Reviews** (`#reviews`, only if the hotel has at least one approved review): real, staff-moderated guest reviews only — `lib/server/reviews.ts`'s `listApprovedReviews`, ruled two-column cards, star rating rendered as filled/outline `lucide` star icons (never JetBrains Mono — a rating isn't a bill fact, so it stays out of the Data register per the Two-Register Rule) over the comment and the guest's own chosen display name. No aggregate score computed or shown anywhere; the section simply doesn't render with zero approved reviews, same as Gallery/About with nothing to show.
- **Footer** (`.storefront-footer`): hotel name/city, one honest trust line ("booked directly… the price you see on review is the price you pay") grounded in PRODUCT.md's actual Positioning — never invented guest counts or review scores — and a repeat "Check availability" CTA.

### Room Detail Page

`/book/rooms/[roomTypeId]` — a real, dedicated page (own URL), not a modal. This pass replaced an earlier Room Details Dialog with this page, per Acacia's own reference (its room detail views are full pages with a top-and-bottom "Book Now," never a popup) — the Flat Ledger Rule now has **zero modal exceptions** left in the guest flow, a cleaner posture than the dialog it replaced. Supports the same dated/undated duality the dialog had (`AvailableRoomType`/`BrowsableRoomType` from `lib/server/availability.ts` carry the full record — photos, description, specs, full amenities). Reached from a "View full details →" link (never from clicking the row itself, which stays reserved for the row's own toggle/CTA), or directly (a shared/bookmarked link, SEO).

Layout, top to bottom, reusing the former dialog's own gallery/spec-chip/amenity classes verbatim (`.storefront-room-dialog-*` — kept that name; only the frame around them changed from a modal to a page): hotel-name eyebrow + Literata room name + a Data-register from-price (`.storefront-room-dialog-price`) + a **Book Now** button, an editorial gallery (one large 16:9 hero frame plus a horizontal thumbnail strip, any photo opens the shared lightbox), full description, a **spec-chip row** (`.storefront-room-dialog-spec-chip` — pill-shaped, bordered, one per fact: occupancy range, size in m², bed configuration with a "(flexible)" qualifier, view type, smoking policy with a lit/unlit cigarette glyph matched to the actual policy, any true accessibility flags), an optional **Check-in/Check-out policy** block (`branding.checkInPolicy`/`checkOutPolicy`, free text, jsonb-backed — omitted entirely if unset, never fabricated), the room type's **full** amenity list grouped by category (`.storefront-amenity-group-head`/`.storefront-amenity-list`, the same device About uses), and a second **Book Now** button at the bottom (per Acacia's own pages carrying the CTA at both ends of a long scroll). "Book Now" is a plain link, not shared state: undated → `/book/dates?roomTypeId=…`; dated (arrived with `checkIn`/`checkOut` already in the URL) → straight to `/book/rooms?checkIn=…&roomTypeId=…`, skipping the Dates step entirely since it's already known. No rate-plan list or "Add to invoice" lives on this page — per Acacia's own pages, that choice happens on Select Rooms & Rates, one step later. Every block is conditional on having data; a room type missing a given attribute simply skips that block.

Each of Select Rooms & Rates, Guest Information, and Review & Payment carries a quiet `.storefront-step-back` "← Back to …" text link above its `<h1>` (ink-muted, not a button — an escape hatch, not the primary action) — explicit `href`s rather than `history.back()`, since Review is also reachable via an external round-trip through PayMongo's own checkout page (a cancelled payment redirects back here), where browser history doesn't point at the previous wizard step. Rooms & Rates → Dates carries the known dates/occupancy/accessibility forward; Guest Information → Rooms & Rates carries the first cart room's dates forward (falling back to the homepage for a hall-only cart, since that's the only place a hall reservation is added); Review & Payment → Guest Information is a fixed link (the cart is already cleared by the time an order exists, so Guest Information shows its own empty-cart state if reached this way — honest, not broken). The Dates step itself has no back link (leaving it means abandoning the search, same as the homepage's own bare state), nor does Confirmation (nothing to go back to after payment).

### Dates Step

`/book/dates` — wizard step 1, "Check-in & Check-out Date." Plain check-in/check-out date fields (not a custom two-month range-calendar widget — a deliberate scope call this pass, in favor of the same native/shadcn date inputs already proven elsewhere in this world, over building new calendar UI from scratch) plus Adults/Children steppers ("Guests, per room" — the only place occupancy is collected anywhere in the flow) and the accessible-only checkbox (moved here from the old homepage search dock). Reached cold from a Room Detail Page's "Book Now" in undated mode, or from the Booking Summary Sidebar's "Edit" links (pre-filled with whatever's currently known) — never from the homepage's own "Check availability," which already has dates and skips straight to Select Rooms & Rates.

### Static Content Pages (Dining / Meetings & Events / Contact Us)

Three more Persuade-mode pages, same posture as the Room Detail Page (own URL, `StorefrontNav` at top, no step chrome): `/book/dining`, `/book/meetings-events`, `/book/contact`. All three, plus the homepage, now share one **`StorefrontNav`** component (`lib/components/storefront/storefront-nav.svelte`) instead of four copies of the same nav markup — it renders every optional link (Meetings & Events, Dining, Reviews) conditionally on real data, and deliberately uses **absolute `/{hotelSlug}/book/...` paths throughout**, not this route tree's usual relative-link convention, since the same component now renders from several different nesting depths and a hand-computed `../` chain has been the single most repeated bug this pass (caught five separate times, always with the same fix: verify with Node's `URL` class, never eyeball it). `functionHalls`/`reviews`/`diningItems` (plus the `dining` config) all live in the shared `book/+layout.server.ts` load so the nav has them on every page, not just the homepage.

- **Dining** (`/book/dining`): a structured multi-venue model, not free text — reversed from an earlier free-text pass once the admin asked for per-venue photo/title/description/hours. Each venue is its own `dining_items` row (a real table, own settings CRUD at `(staff)/settings/dining`, own detail page per item — mirrors the Function Hall table's modeling, since each venue needs its own photo-upload lifecycle), rendered one per section (photo, Literata title, description, an optional operating-hours spec chip) in the same ruled-section idiom Meetings & Events uses for halls. Below the venue list, a separate **menu photo gallery** (`hotels.config.dining.menuImages`, its own jsonb key, sibling to `branding` rather than nested under it — a hotel-wide gallery of menu boards/printed menus with no natural per-venue owner) — same `.storefront-gallery-grid` + lightbox as the main Gallery section. Omits itself gracefully ("Dining information is coming soon") if there are no venues yet; the nav link itself only appears once there's a venue or a menu photo to show.
- **Meetings & Events** (`/book/meetings-events`): a fuller presentation of the **same real Function Hall data** the homepage's `#function-hall` section already uses (`listFunctionHalls`) — full photo gallery per hall (reusing the Room Detail Page's `.storefront-room-dialog-photo-main`/`-photo-strip` gallery pattern), full description, capacity as a spec chip, included services and supported event types as their own labeled blocks, and a **"Reserve this hall"** button linking to `/book#function-hall` — the live reservation mini-form and quote endpoint stay exactly where they are on the homepage; this page is informational, not a second booking form. This is a hotel's Room Detail Page equivalent for its function hall(s): each hall's `<section>` carries `id="hall-{hallId}"` (`scroll-mt-24` so the sticky nav doesn't cover it on jump), and the homepage's own `#function-hall` card links into it via a **"View full details →"** affordance (`.storefront-view-details-btn`, the same class the Rooms & Rates browse grid uses) — no separate per-hall route was built, since this page already shows everything a dedicated one would, just for every hall on one page rather than one hall per URL.
- **Contact Us** (`/book/contact`): `branding.contactAddress`/`contactPhone`/`contactEmail` as plain ruled rows (`.storefront-contact-row`, an icon + the fact — `tel:`/`mailto:` links, not a form; this app's existing pattern is guests reaching the hotel directly, not through a ticketing system) plus an embedded map (`.storefront-contact-map`), still a **plain Google Maps embed, no API key**. It prefers a precise `contactLat`/`contactLng` pin (`google.com/maps?q=<lat>,<lng>&output=embed`) — dropped by staff on a real interactive map in Branding settings, see below — falling back to the old address-search embed (`q=<address>`) when no pin is set. Every row and the map itself are independently conditional — a hotel that's only set a phone number shows just that row, no empty placeholders for the rest.

Meetings & Events and Contact Us stay hotel-admin-editable from `(staff)/settings/branding` (Check-in/Check-out policy, Contact fields — the same jsonb-backed `branding` object, no new tables, no migration). Dining has its own settings area (`(staff)/settings/dining`, a settings-index tile of its own) — a `dining_items` table (list/create/edit/delete, single-photo replace semantics per venue) plus the separate `hotels.config.dining.menuImages` gallery (multi-photo append semantics, matching the Gallery-photos pattern).

The Contact section of Branding settings also carries a real interactive map (`lib/components/staff/location-picker.svelte`, Leaflet + OpenStreetMap tiles — free, no API key, unlike Google's JS API — a deliberate choice to keep this app's "no map API key anywhere" posture intact even for the staff-side picker) below the Address field: click to drop a pin, drag to move it, "Clear pin" to fall back to the address-search embed. `contactLat`/`contactLng` submit as two hidden inputs alongside the rest of the branding form — same single `?/updateBranding` action, no separate endpoint. Client-only (Leaflet touches `window`), so the map itself only initializes in `onMount`, dynamically imported to keep it out of the SSR bundle.

## Floating Invoice

Scoped to the **bare homepage only** as of this pass (Persuade mode) — a guest can add a Function Hall reservation (the one product still sold inline on the homepage; Rooms & Rates moved to the wizard) without ever entering the room-booking wizard, and still needs a way to reach checkout. `.storefront-invoice`, fixed bottom-right, mounted once from `book/+layout.svelte` (a `CartStore` — `lib/cart.svelte.ts` — shared via Svelte context, `sessionStorage`-backed), `visible={!showStepChrome}`. Two states, both flat per the Flat Ledger Rule (no shadow):
- **Collapsed** (`.storefront-invoice-pill`): a pill with a small woven-pattern circle (`.storefront-invoice-count`, the item count in the Data register) and the running total.
- **Expanded** (`.storefront-invoice-panel`): a `--ledger-paper` card with a woven-pattern header band, each line item (name, a one-line detail, its own total) with a remove affordance, a Subtotal-style total row, and a "Proceed to checkout" `ledger-btn-primary` linking straight to `details`.

## Booking Summary Sidebar

The wizard-chrome counterpart to the Floating Invoice, for **Select Rooms & Rates and Guest Information only** (`lib/components/storefront/booking-summary-sidebar.svelte`, mounted from `+layout.svelte` as a second grid column — `lg:grid-cols-[1fr_320px]` — occupying the space the earlier vertical step-rail freed up when it became horizontal). Not shown on Dates (nothing chosen yet), Review & Payment (the cart is already cleared by then — `createOrder` clears it on success — and Review has its own authoritative, DB-backed itemized bill), or Confirmation (the ticket takes over). A static (not fixed/floating) `--ledger-paper` panel, hairline border, no shadow: Date / Guests / Special Code rows (Label+Data pairing, Data register for the facts) each with an "Edit" link back to the Dates step pre-filled with whatever's currently known — the only place occupancy can be corrected once past that step, since Select Rooms & Rates itself only collects room count, not occupancy — then the same itemized cart list, running total, and "Continue" CTA the Floating Invoice's expanded state uses (`itemLabel`/`itemDetail` extracted to one shared `$lib/cart-display.ts` helper this pass, ending a two-way duplication between the Floating Invoice and the old inline Details bill).

A room stay and a function hall reservation can sit in the same invoice and pay together in one PayMongo session — `details`'s `createOrder` action re-verifies availability and re-prices every line server-side before creating one `orders` row with the guest's room and/or hall bookings under it; the review and confirmation pages render every line itemized, and the confirmation ticket lists every line the same way.

**Special Code — flagged, not fabricated:** captured and displayed end-to-end (homepage → sidebar), but there is no discount/promo-code redemption engine anywhere in this codebase. It never reaches `createOrder` and never affects price. Treat the field as informational only until a real promo engine exists.

### Deliberately not built
Reference sites in this category (OTA/chain booking engines) commonly also show: a loyalty points program/"Member Only Rate" (no guest loyalty system exists, only staff `memberships`), a language/currency switcher (currency is hardcoded PHP through `pricing.ts`; no i18n setup), a real embedded map (`hotels` has no lat/lng), and a working promo-code engine (the Special Code field is capture-and-display only — see Booking Summary Sidebar). A custom two-month range-calendar widget on the Dates step was also deliberately skipped in favor of the proven native/shadcn date inputs already used elsewhere. None of these are missing by oversight — adding the control (or the visual) without the backing feature/engineering investment would promise something the product can't actually do, or wasn't worth building from scratch this pass. (Star ratings and reviews *are* now real and built — see Storefront's Reviews section above; a multi-*item* cart across different products *is* now real too — see Booking Summary Sidebar above; multiple rooms *of the same type* in one search line *is* now real too, via `/book/rooms`'s per-card Rooms stepper — see Select Rooms & Rates above. All three used to be on this list.)

The room-count feature itself has a narrower, explicit v1 boundary: room count is one value per card, set at add-to-cart time, not editable on a line already in the cart, and not mixable across different room types/plans in one cart (booking 2 Deluxe Twins and 1 Suite in one visit means adding two separate cart lines with the stepper set differently for each add, not one line with a per-type quantity). Per-line quantity editing in the Booking Summary Sidebar is a reasonable future enhancement, not built now.

## Elevation & Depth

Flat by default — this is a paper-and-ink world, not a glassy one. Depth comes from the ruled hairlines and the woven pattern's own value contrast, not shadows. The one exception is the confirmation ticket, which lifts very slightly (a single soft ambient shadow) to read as a physical object placed on the page, echoing a ticket stub set down on a desk.

### Shadow Vocabulary
- **Ticket lift** (`box-shadow: 0 8px 24px -8px oklch(0.26 0.02 60 / 0.18)`): the confirmation ticket only. No other component uses a shadow.

### Named Rules
**The Flat Ledger Rule.** Everything but the confirmation ticket is flat. A hover state changes background tint or rule weight, never adds a shadow.

## Shapes

Corners stay restrained (`rounded.sm`/`md` — 4–10px) everywhere except the confirmation ticket, which uses a genuine perforated-edge silhouette (a repeating semicircle notch along its top edge, painted as page-colored circles over the ticket's woven frame via a `radial-gradient` — chosen over a composited `mask-image` for more consistent cross-browser rendering) and a slightly larger radius (`rounded.lg`, 18px) on its two bottom corners only, as if the top were torn from a longer form. Buttons and inputs are simple rounded rectangles (`sm`) — the form language saves its one distinctive gesture for the ticket.

## Components

### Buttons
- **Shape:** rounded rectangle (4px).
- **Primary:** flat `--hotel-accent` fill, `--ledger-paper` text, Inter 600, generous horizontal padding (`px-6 py-3`). No gradient, no shadow.
- **Hover / Focus:** background shifts to accent-thread-deep; focus-visible gets a 2px ring in the accent color offset 2px (matches shadcn's existing focus-ring convention from the staff app, so keyboard behavior stays consistent across both worlds even though the palette differs).
- **Secondary / Ghost:** `--ledger-ink` text on transparent, gains a `--ledger-rule` bottom border on hover only (a ledger underline, not a filled button).

### Ruled Rows (signature component)
Each room type or line item is a horizontal band: a photo panel (`.ledger-room-photo` — the room's own cover photo, or the woven pattern plus a large initial-letter mark if it has none) → content (Literata headline + Inter body) → right-aligned Data column (price, from `₱X,XXX/night`) → chevron affordance. Separated by 1px `--ledger-rule`. On expand (rate plan detail, dated search only), the row grows downward with an inset sub-ledger, not an overlay/modal.

### Cards / Containers
- **Corner Style:** `sm` (4px) for form panels; ticket is the sole `lg` exception (see Shapes).
- **Background:** `--ledger-paper` on `--ledger-paper-2` sections for alternation, never white-on-white.
- **Shadow Strategy:** none, per Elevation & Depth.
- **Border:** hairline `--ledger-rule` only where a hard edge is needed (e.g. the review screen's bill panel); prefer a rule below content over a full border box.

### Inputs / Fields
- **Style:** underline-style (bottom border only, `--ledger-rule`, thickening to 2px accent on focus) for text fields — reinforces the ruled-ledger register even in form contexts. Date pickers and selects use shadcn-svelte's existing components (per project convention), restyled with these tokens rather than rebuilt from scratch.
- **Error:** border/underline shifts to `--danger` (reuse the staff app's existing danger token — errors don't need a new world).

### The Confirmation Ticket (signature component)
A single bordered, perforated-top card: `--hotel-accent` weave pattern as a 6–8px full-saturation border stripe around all four edges, `--ledger-paper` interior, booking details laid out as a manifest table in JetBrains Mono (route-style rows: HOTEL → GUEST, CHECK-IN → CHECK-OUT, NIGHTS, TOTAL, CONFIRMATION CODE), "Ticket lift" shadow. This is the one moment the flat-by-default rule and the small-radius rule both yield — it is meant to feel like a physical object worth keeping.

Built as two nested layers (`.ledger-ticket-frame` behind `.ledger-ticket`): the outer frame paints `--hotel-woven-pattern` as its full background and shows through as the border stripe; the inner ticket sits on `--ledger-paper` with its own slightly smaller radius. This is what makes the border the real weave rather than a flat `--hotel-accent` rectangle — a plain CSS `border-color` cannot render a tiled pattern, so the visible "border" is background peeking around the inset interior instead.

**Email variant** (`src/lib/server/email/booking-confirmation.ts`, sent after an online booking's payment confirms — see `.impeccable/surfaces/src-lib-server-email-booking-confirmation.md`). The Confirmation Ticket carried to the inbox: 600px table-based layout, all styles inline, a `text/plain` alternative alongside. The email medium forces four scoped substitutions of the world's own documented fallbacks — the woven frame becomes a **flat `--hotel-accent` 6px border stripe** (the nested-layer weave can't survive an email client; DESIGN's "small UI may use the flat accent directly" carve-out applies), the perforated edge is dropped, Literata falls back to Georgia, and the "Ticket lift" shadow becomes a 1px `--ledger-rule` frame. Everything else holds: the manifest table in the mono data register (label left / value right, stacked rather than arrow-paired for legibility at 600px), the two type registers, the warm off-white ground (`#f4f1ea` for a default-white hotel, so the mail never reads as the cool staff shell), one flat-accent CTA button, and the storefront footer's honest trust line. Per-hotel `accentColor`/`paperColor` drive it exactly as on the web; `--ledger-ink-muted` is nudged to `#6b6155` to clear 4.5:1 on both the white ticket and the warm ground.

### Navigation
Two distinct headers, never both on screen at once. On the five wizard steps (`dates`/`rooms`/`details`/`review`/`confirmation`, Operate mode): a compact mobile header below `lg:` — hotel name (Literata) + logo (if set) on the left, step indicator ("2 OF 5 — SELECT ROOMS & RATES") in Data register on the right — and the horizontal step tracker (`.ledger-stepper-horizontal`) at `lg:` and above; no other links either way, a focused task surface. On the bare homepage, the Room Detail Page, and the three static content pages (Dining/Meetings & Events/Contact Us — Persuade mode, none are wizard steps): the shared `StorefrontNav` component (see Static Content Pages) — hotel name/logo, anchor and page links, one gold "Reserve" action. No staff-app sidebar leaks into any of it.

## Do's and Don'ts

### Do:
- **Do** compute the woven pattern from the hotel's own `branding.accentColor` at render time — never hardcode a demo hotel's color into a shared component.
- **Do** keep every price/date/code in the JetBrains Mono data register, right-aligned in ledger context.
- **Do** let a hotel with zero photos and no logo still look intentional: the woven pattern and ruled-row layout carry identity even with a bare `branding` object (per PRODUCT.md's "graceful with partial data" principle).
- **Do** reuse shadcn-svelte primitives (button, input, select, dialog, calendar, table) as the interaction layer, restyled with this world's tokens, rather than hand-rolling new primitives.

### Don't:
- **Don't** let this world leak into the authenticated staff app — the staff shell keeps its existing oklch/shadcn theme unchanged.
- **Don't** render the accent as a flat color-block hero (that's the OTA-generic rut this world exists to refuse) — large regions get the woven pattern, not a solid fill.
- **Don't** add shadows anywhere except the confirmation ticket.
- **Don't** invent fake review scores, guest counts, or star ratings — PRODUCT.md confirms there's no real review data to show.

<!-- ===================================================================== -->

<!-- AS-BUILT: the print-document component and its route shell are implemented under
     src/lib/components/print/accountable-form.svelte and src/routes/[hotel]/print/ per this
     section. Tokens below are prose-normative — a single DESIGN.md carries one machine-readable
     frontmatter block, held by the Woven Ledger world above; every value here is copied from
     the shipped scoped CSS. This world is deliberately separate from both the Woven Ledger
     guest world above and the staff app's shadcn/oklch operate shell. -->

# Design System: MM Hotel — Accountable Forms (print)

**Scope: the printable / PDF documents a hotel issues from a folio** — `src/routes/[hotel]/print/**` and the shared `accountable-form.svelte` component. Currently Invoice and Official Receipt (incl. a Refund variant); later X-reading, Z-reading, and the OR-liquidation register as per-type variations of the same A4 shell. Rendered byte-identically for a guest (order `access_token`) and for staff, and to PDF. It does **not** style the `/{hotel}/finance/**` management screens — those keep the staff shadcn/oklch shell. A guest booking route never inherits this world; this world never inherits either of the other two.

## Overview

**Creative North Star: "The BIR-Registered Accountable Form"**

The document is authoritative because it is spare, ruled and serial-numbered — a Philippine Bureau of Internal Revenue accountable form — not because it is branded. It rejects the category default of a "nice branded PDF receipt": no logo watermark, no accent panel, no gradient, no "Thank you for your stay" hero. What signals officialdom is the fine double-rule frame around the whole page, the brick-red document-type word and serial number top-right, and an otherwise uninterrupted ink-on-white ruled page whose empty space is filled with pre-printed ruling rather than left blank.

Two type registers only, and they never trade jobs: Inter carries every label, name and sentence; JetBrains Mono carries every figure — amount, serial, date, TIN, reference — with tabular figures, right-aligned in columns so a reader can add them up by eye. The layout is measured in millimetres and points because the artifact is a sheet of A4 paper, not a viewport; it is fixed at 210mm wide and does not respond.

The page must survive the print path: `print-color-adjust: exact` keeps the red and the rules, `break-inside: avoid` keeps every bill fact whole across a page break, and the statutory footer is config-driven — the full permit / accredited-printer / serial-range / five-year-validity block when the hotel's BIR identity is set, a single honest "computer-generated, not a BIR-registered document" line until then.

**Key characteristics:**
- Ink on pure white, with exactly one non-ink colour (brick red) on exactly two elements.
- 3px double-rule outer frame around the entire page, inside a ~10mm margin.
- Inter for structure, JetBrains Mono for every figure — a hard two-register split.
- Ruled filler rows extend a sparse document down to the totals so it reads as pre-printed stationery.
- Geometry in mm / pt; fixed 210mm width; not responsive by design.
- No serif display face, no shadow, no rounded corner, no tinted fill anywhere.
- The statutory footer is driven entirely by the hotel's stored BIR config.

## Colors

Ink-on-white, hotel-agnostic and fixed. All values are literal in `accountable-form.svelte`'s scoped CSS as `--af-*` custom properties on `.af-page`; there is no per-hotel palette computation the way the Woven Ledger world has.

### Primary
- **Accountable-form brick red** (`--af-red`, `#a3272e`): the one non-ink colour. Used on exactly two elements — the document-type word (`.af-doctype`) and the serial number (`.af-serial-no`), both top-right. Appears nowhere else on the page.

### Neutral
- **Document ink** (`--af-ink`, `#1a1a1a`): all primary text, the double-rule frame, structural 1px dividers (table-header underline, totals-line rule, signature rules, amount-in-words box, foot-grid top), and the default value of `--af-accent`.
- **Soft ink** (`--af-ink-soft`, `#55524c`): secondary text — field labels, the trade-name and address lines, the `(VAT-exempt)` qualifier, totals row labels, the copy tag when it reads `ORIGINAL`, and the entire legal / disclaimer footer.
- **Rule** (`--af-rule`, `#b7b2a8`): hairline ruling that is not structural — line-item row separators, the repeating-gradient filler rows, the copy-tag border, the legal-footer top rule, and the on-screen (non-print) page border.
- **Paper** (`#fff`, pure white): the only ground. No section bands, no zebra rows, no tints.

### Accent (per-hotel, optional, single-use)
- **Hotel accent rule** (`--af-accent`, defaults to `var(--af-ink)`): passed in via the component's `accent` prop and applied to exactly one element — the 2px `.af-accent-rule` under the letterhead. If no accent is supplied it is ink. A hotel accent never touches anything else on the page.

### Preview-shell chrome (not part of the document)
- **Preview ground** (`#6b6b6b`, mid-grey) and the toolbar button (`#fff` fill, `#1a1a1a` border, `#f0efec` hover) live in `print/+layout.svelte` and are stripped `@media print`. They frame the document on screen; they are not document tokens and are not a design-system button.

### Named Rules
**The Ink-and-One-Red Rule.** The page is ink on white. Brick red (`#a3272e`) appears on the document-type word and the serial number and nowhere else — not on totals, not on rules, not on headings. Every other mark is `--af-ink`, `--af-ink-soft`, or `--af-rule`.

**The One-Accent-Rule Rule.** A hotel's brand accent is permitted on a single 2px rule beneath the letterhead and on nothing else. It defaults to ink when unset; a too-light accent simply reads as a faint rule, never as a fill.

## Typography

**Structure / body font:** Inter Variable (`'Inter Variable', 'Inter', system-ui, sans-serif`), self-hosted via `@fontsource-variable/inter`. Base size 10pt, line-height 1.4.
**Figure font:** JetBrains Mono Variable (`'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace`), self-hosted via `@fontsource-variable/jetbrains-mono`, always with `font-variant-numeric: tabular-nums`. Applied through the `.af-mono` class.
**Display font:** none. The world deliberately has no serif or display face; the largest type is the letterhead legal name set in Inter.

**Character:** utilitarian and photocopier-proof. Inter is the form's printed labels and the parties' names; JetBrains Mono is the "verify this against your books" voice and appears only in tabular or single-value numeric contexts, right-aligned wherever it sits in a column.

### Hierarchy
- **Letterhead name** (Inter, 700, 15pt, uppercase, letter-spacing 0.01em): the hotel legal (or trade) name, top-left — the one moment of size on the page.
- **Document type** (Inter, 700, 13pt, uppercase, letter-spacing 0.08em, `--af-red`): `INVOICE` / `OFFICIAL RECEIPT` / `OFFICIAL RECEIPT (REFUND)`, top-right.
- **Serial number** (JetBrains Mono, 700, 13pt, `--af-red`): `No. INV-000123`, directly under the document type. Grouped `PREFIX-000000` by `formatSerial` (a hyphen is inserted when the prefix ends alphanumeric; `serialPadWidth` default 6).
- **Party value** (Inter, 600, 11pt): the bill-to / received-from name.
- **Body / line item** (Inter, 400, 9.5pt, line-height 1.4): line descriptions; the amount-in-words value is 500 weight.
- **Label** (Inter, 600, 7.5pt, uppercase, letter-spacing 0.06em, `--af-ink-soft`): every field label — `BILL TO`, `DESCRIPTION`, `AMOUNT IN WORDS`, the table header row, totals labels.
- **Copy tag** (Inter, 7.5pt, uppercase, letter-spacing 0.14em): `ORIGINAL` (soft ink, rule border) or `REPRINT` (full ink, ink border), boxed under the serial.
- **Secondary line** (Inter, 8.5–9pt, `--af-ink-soft`): the "operating as" trade name, address, and TIN / VAT-registration line (TIN portion in `.af-mono`).
- **Legal footer** (Inter, 7.5pt, line-height 1.5, `--af-ink-soft`; `.af-legal-strong` is 700 + full ink): the statutory or disclaimer block.
- **Figure** (JetBrains Mono, tabular-nums; size tracks context — 9pt in the totals ladder, 9.5pt in line items, 13pt in the serial, 8.5pt in the meta list): every peso amount (`PHP 1,234.00`), quantity, date, business date, TIN, booking / folio / order reference. Right-aligned in every column.

### Named Rules
**The Two-Register Rule.** If it is a value you would reconcile against a bill or a ledger — money, quantity, date, serial, reference, TIN — it is set in JetBrains Mono with `tabular-nums` and right-aligned in its column. If it is a name, a label, or a sentence, it is Inter. Nothing on the page mixes the two within one data point.

**The No-Display-Face Rule.** There is no serif and no display font. Emphasis comes from weight (700), size (never above 15pt), letter-spacing, and the brick red — never from a second typeface.

## Layout

A single fixed-layout A4 page. `.af-page` is `210mm` wide, `min-height: 297mm`, centred with `margin: 0 auto`, `padding: 10mm` (the on-screen stand-in for the print margin), `background: #fff`. The real print geometry is set by `@page { size: A4; margin: 10mm }`; in `@media print` the `.af-page` drops its own margin/padding and width (`width: auto`) so it does not double the `@page` margin, and `.af-frame` takes `min-height: 265mm` to fill the printable area. On screen (`@media screen`) the page gets `margin: 24px auto` and a 1px `--af-rule` border, sitting on the preview shell's grey ground.

**Frame.** `.af-frame` is `border: 3px double var(--af-ink)`, `padding: 6mm`, `min-height: calc(297mm - 20mm)`, and a vertical flex column so the ruled filler can grow.

**Vertical order (top to bottom):** letterhead + serial header (`.af-head`, flex `space-between`, gap 10mm; serial column `text-align: right`, `min-width: 62mm`) → 2px accent rule (`margin: 4mm 0`) → parties block (`.af-parties`, flex `space-between`, gap 10mm) → line-item table (`.af-lines`, full width, `border-collapse: collapse`) → ruled filler (`.af-lines-fill`, `flex: 1`, `min-height: 12mm`) → foot grid (`.af-foot-grid`, flex, gap 6mm, `border-top: 1px solid var(--af-ink)`) holding the amount-in-words box (`flex: 1`) beside the totals ladder (fixed `78mm` wide) → signature block (`.af-signatures`, flex, gap 14mm, `margin-top: 10mm`) → legal footer (`.af-legal`, `margin-top: 6mm`, `border-top: 1px solid var(--af-rule)`).

**Table.** Header cells: 7.5pt uppercase label, `border-bottom: 1px solid var(--af-ink)`. Body cells: 9.5pt, `border-bottom: 1px solid var(--af-rule)`, `vertical-align: top`, padding `1.6mm 2mm`. The three numeric columns (Qty, Unit price, Amount) are `text-align: right`, `white-space: nowrap`, `.af-mono`.

**Ruled filler.** A `repeating-linear-gradient` of `--af-rule` hairlines at the line-item row pitch (`calc(1.6mm + 9.5pt)`), `flex: 1` so it always stretches the page down to the totals — the mechanism that makes a one-line invoice still read as a pre-printed form.

**Spacing rhythm.** All in mm / pt: section gaps 4–6mm, header/parties inter-column gap 10mm, signature gap 14mm, cell padding 1.6mm × 2mm, totals row padding 0.8mm vertical. There is no px/rem spacing scale — this is a paper document.

**Print survival.** `-webkit-print-color-adjust: exact` + `print-color-adjust: exact` on `.af-page`. `break-inside: avoid` on `.af-foot-grid`, `.af-words`, `.af-signatures`, `.af-legal`, and every `.af-lines tbody tr`. `color-scheme: light` forced on `html` by the print layout.

### Named Rules
**The Paper-Units Rule.** Page geometry is expressed in millimetres and points, never rem or px. The page is a fixed 210mm sheet; a narrow screen scrolls it horizontally and the PDF is unaffected. Do not make this layout responsive.

**The Pre-Printed Form Rule.** A document never leaves a blank void above its totals. The ruled filler grows to fill whatever space the line items don't, so a sparse receipt reads as stationery, not as a short email.

## Elevation & Depth

Entirely flat. No `box-shadow`, no `filter`, no layering anywhere in the document. Depth and hierarchy come from exactly two devices: the 3px double-rule outer frame, and 1px horizontal rules — `--af-ink` for structural dividers (table header, totals line, signature lines, amount-in-words box, foot-grid top) and `--af-rule` for secondary ruling (row separators, filler, footer rule). The only non-flat thing in the route is the preview shell's grey ground behind the sheet, which is chrome, not the document, and is removed in print.

### Named Rules
**The Flat Print Rule.** No shadows, no fills, no rounded corners — ever. If a region needs to be set apart, it gets a 1px rule or a 1px box, not a tint or a lift.

## Shapes

Right angles only. No element sets `border-radius`; corners are square throughout. The signature silhouette is the `3px double` outer frame (`border: 3px double var(--af-ink)`) around the entire page. Boxes are drawn with 1px borders: the amount-in-words box (`1px solid var(--af-ink)`) and the copy tag (`1px solid var(--af-rule)`, or `var(--af-ink)` when `REPRINT`). Rules are 1px except the letterhead accent rule, which is 2px. The logo, when present, is constrained to `max-height: 16mm` / `max-width: 55mm`, `object-fit: contain` — never cropped, never a circle.

## Components

### Print shell & toolbar (`print/+layout.svelte`)
- **Character:** a neutral preview frame that disappears when printed. Not a design-system surface.
- **Ground:** mid-grey (`#6b6b6b`), `min-height: 100vh`, 40px bottom padding.
- **Toolbar:** centred, 16px padding, a single "Print / Save as PDF" button — Inter 500 13px, `#fff` fill, `1px solid #1a1a1a` border, no radius, padding `9px 18px`, hover `#f0efec`.
- **Print:** `@media print` sets the ground to `#fff`, removes padding, and hides the toolbar entirely.

### Letterhead lockup (`.af-letterhead`)
Top-left. Optional logo image, then the hotel legal name (15pt Inter 700 uppercase); an "operating as {trade name}" line when legal ≠ trade; an address line; and a `.af-mono` line carrying `TIN {tin} · VAT REGISTERED` or `· NON-VAT REGISTERED`.

### Serial block (`.af-serial`)
Top-right, `text-align: right`, `min-width: 62mm`. Document-type word (brick red) → `No. {formattedNo}` (brick red mono, 13pt) → copy tag → a definition list of `Date issued` (mono datetime), `Business date` (mono), and `Prepared by` (Inter, name) with values right-aligned, `min-width: 34mm`.

### Copy tag (`.af-copy-tag`)
Inline-block, `1px` border, padding `0.5mm 2mm`, 7.5pt, letter-spacing 0.14em. `ORIGINAL` = `--af-ink-soft` text + `--af-rule` border; `.is-reprint` `REPRINT` = `--af-ink` text + `--af-ink` border. The only state variance in the world.

### Letterhead accent rule (`.af-accent-rule`)
A single `height: 2px` bar, full width, `background: var(--af-accent)` (ink by default), `margin: 4mm 0`. The one place a hotel's colour is allowed.

### Parties block (`.af-parties`)
Two columns. Left: `BILL TO` (or `RECEIVED FROM` for a receipt) label + 11pt/600 name + optional address and `.af-mono` TIN sub-lines. Right (`.af-ref`, `text-align: right`, 8.5pt): whichever of Applied-to-invoice, Booking, Dates, Folio, Order references exist, each a label + `.af-mono` value.

### Line-item ledger (`.af-lines`)
Full-width collapsed table. Columns: Description / Qty / Unit price / Amount. Header row is a 7.5pt uppercase label row with a `1px solid var(--af-ink)` underline. Body rows separated by `1px solid var(--af-rule)`. Numeric columns right-aligned mono, nowrap. An inline `(VAT-exempt)` qualifier (`.af-exempt`, 8pt, soft ink) trails a non-vatable description on a VAT-registered invoice.

### Ruled filler (`.af-lines-fill`)
`aria-hidden` block of repeating hairline rules at row pitch, `flex: 1`, `min-height: 12mm`. Purely visual — extends the ledger to the totals.

### Amount-in-words box (`.af-words`)
`flex: 1`, `border: 1px solid var(--af-ink)`, padding `2.5mm 3mm`. `AMOUNT IN WORDS` label + a `.af-mono` 9.5pt/500 value like `FIVE HUNDRED SIXTY PESOS AND 00/100 ONLY`.

### Totals ladder (`.af-totals`)
Fixed `78mm`, right of the amount-in-words box, 9pt. Each row is a flex `space-between` of a soft-ink `<dt>` and a right-aligned `.af-mono` `<dd>`. `.af-total-line` rows (`Total` / `Amount paid`, and `Balance due`) get `border-top: 1px solid var(--af-ink)` and 700 weight with a full-ink label.
- **Invoice variant:** VATable sales / VAT-exempt sales / (Zero-rated sales) / VAT (12%) — the VAT block only when the hotel is VAT-registered — then **Total**, Less: payments received, **Balance due**.
- **Official Receipt variant:** **Amount paid**, Payment method (Inter, not mono), Reference no. (mono, when present), Cash tendered + Change (when a cash tender exists), Balance carried forward (when known).

### Signature block (`.af-signatures`)
Two equal columns, gap 14mm, `margin-top: 10mm`. Each: a `border-top: 1px solid var(--af-ink)` rule + a 7.5pt label — `Prepared by` / `Authorized representative` for an invoice, `Received payment by` / `Payor / authorized representative` for a receipt.

### Statutory footer (`.af-legal`)
`margin-top: 6mm`, `border-top: 1px solid var(--af-rule)`, 7.5pt soft ink.
- **BIR configured** (`snapshot.bir.configured`): permit / ATP no. (+ issue date) and accredited-printer line (+ accreditation no.); an authorized serial-range line when present; `THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.` (`.af-legal-strong`) when non-VAT; a five-year-validity sentence.
- **Not configured:** a single `.af-legal-strong` line — "Computer-generated {type} for the guest's reference. This is not a BIR-registered document…".
- An optional hotel `footerNote` is appended in either case.

## Do's and Don'ts

### Do:
- **Do** keep brick red (`#a3272e`) on exactly the document-type word and the serial number — nowhere else.
- **Do** set every figure — money, quantity, date, serial, reference, TIN — in JetBrains Mono with `tabular-nums`, right-aligned in its column.
- **Do** let the ruled filler grow so a one-line document still fills the page as a pre-printed form.
- **Do** keep the whole page inside the `3px double` `--af-ink` frame, within a ~10mm margin (`@page` for print, `.af-page` padding for screen).
- **Do** drive the statutory footer entirely from the hotel's stored BIR config — full permit / printer / serial-range / validity block when complete, single "computer-generated, not BIR-registered" line when not.
- **Do** guard the totals grid, amount-in-words box, signature block, legal footer, and every ledger row with `break-inside: avoid`, and set `print-color-adjust: exact`.
- **Do** add new document types (X-reading, Z-reading, liquidation register) as per-type header / body / totals variations of this one A4 shell, reusing the `--af-*` tokens.
- **Do** express page geometry in mm / pt.

### Don't:
- **Don't** add a logo watermark, accent panel, gradient, tinted fill, section band, zebra row, or "Thank you" hero — the form's authority is its spareness.
- **Don't** introduce a serif or display typeface, a rounded corner, or any shadow.
- **Don't** let the hotel accent past the single 2px letterhead rule.
- **Don't** use px or rem for page geometry, and don't make the layout responsive — the sheet is a fixed 210mm; a narrow screen scrolls, the PDF does not change.
- **Don't** put a figure in Inter, or a name / label in mono.
- **Don't** style the `/{hotel}/finance/**` BIR-management screens with this world — they stay on the staff shadcn/oklch shell.
