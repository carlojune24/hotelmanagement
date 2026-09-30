# Security & Integrity Issues — Settings › Rates & Policies

| | |
|---|---|
| **Scope** | Staff settings for rate plans, price overrides, seasonal rates, cancellation policies, security-deposit policies, promo codes, and check-in/check-out policy |
| **Reviewed** | 2026-09-30 |
| **Method** | Manual code review (read-only). Data flow traced from form → validation → database → consumer. |
| **Not done** | None of the findings below were exploited against a running instance, and no database rows were changed. Every "Verified by" line says what was actually read. |
| **Status** | All findings **Open** — nothing has been fixed yet. |

## Files in scope

| File | What it does |
|---|---|
| `apps/hotel/src/routes/[hotel]/management/settings/rates/+page.server.ts` | Create/update cancellation policies, deposit policies, rate plans, promo codes |
| `apps/hotel/src/routes/[hotel]/management/settings/rates/[ratePlanId]/+page.server.ts` | Update a rate plan; add/remove daily price overrides and seasonal rates |
| `apps/hotel/src/routes/[hotel]/management/settings/check-in-out/+page.server.ts` | Check-in/out times, late-checkout and early-check-in fees |
| `apps/hotel/src/lib/server/pricing.ts`, `booking-modify.ts`, `availability.ts` | Read the settings above to price and list rooms (consumers) |
| `apps/hotel/src/lib/server/promo-codes.ts`, `.../(guest)/details/+page.server.ts` | Promo lookup and redemption at guest checkout |

## Threat model

- The platform hosts **many hotels**. Each hotel's admin holds `hotel:admin` for **their own** hotel only and must never be able to read or change another hotel's data. Findings marked *cross-tenant* break that rule.
- Guest booking pages are **public and unauthenticated**. Anything shown there (including internal IDs) should be treated as known to an attacker.
- A hotel admin is **semi-trusted**: trusted to run their hotel, not trusted with other hotels' pricing.

## Summary

| ID | Severity | Title | Type |
|---|---|---|---|
| [RATES-001](#rates-001) | 🔴 **High** | Price overrides and seasonal rates can be written to another hotel's rate plan | Broken access control (cross-tenant IDOR) |
| [RATES-002](#rates-002) | 🟡 Medium | Promo codes have no usage limits and no guess protection | Business-logic abuse / brute force |
| [RATES-003](#rates-003) | 🟡 Medium | Rate plans can reference another hotel's room type and policies | Broken access control (cross-tenant reference) |
| [RATES-004](#rates-004) | 🟢 Low | No upper bound on any money field; `Infinity` crashes the save | Input validation |
| [RATES-005](#rates-005) | 🟢 Low | Impossible times accepted for check-in / check-out | Input validation |
| [RATES-006](#rates-006) | 🟢 Low | Malformed IDs on delete actions cause server errors | Input validation / error handling |
| [RATES-007](#rates-007) | 🟢 Low | Rate plan update writes an audit entry even when nothing changed | Audit integrity |
| [RATES-008](#rates-008) | 🟡 Medium | Promo discount does not reduce the VAT shown on invoices | Tax accuracy (needs accountant decision) |

Suggested fix order: **001 → 003 → 002 → 008 (after accountant sign-off) → 004 → 005/006/007**.

---

## RATES-001
### 🔴 High — Price overrides and seasonal rates can be written to another hotel's rate plan

**Type:** Broken access control — cross-tenant IDOR (write)
**Files:** `settings/rates/[ratePlanId]/+page.server.ts` — `addOverride` (action at line 175, insert at 184), `addSeason` (action at line 234, insert at 247)

#### What is wrong
Both actions take the rate plan from the URL (`event.params.ratePlanId`) and insert straight into `daily_rates` / `seasonal_rates`, stamping the *caller's* `hotelId` on the new row. Neither action checks that the rate plan actually belongs to the caller's hotel.

The page's `load` **does** check this (line 36: `where(and(eq(ratePlans.id, params.ratePlanId), eq(ratePlans.hotelId, hotelId)))`), so opening the page for someone else's plan returns a 404 — but the write actions were never given the same check. Anyone who POSTs directly to the action skips the page entirely.

#### Why it matters — the consumer never checks the hotel
The pricing code selects overrides and seasons by **rate plan ID only**:

- `pricing.ts:166` — `from(dailyRates)` filtered by `ratePlanId` and date range only
- `pricing.ts:184` — `from(seasonalRates)` filtered by `ratePlanId` and date range only
- `booking-modify.ts:127` and `:136` — same pattern

So a row written under Hotel A but pointing at Hotel B's plan is picked up when Hotel B's guests are priced.

#### Attack scenario
1. Attacker is a legitimate admin of **Hotel A** (`/hotelA/...`).
2. They obtain a rate plan ID belonging to **Hotel B**. This is easy: rate plan IDs appear in Hotel B's public booking pages (room results and the cart payload — `rooms/+page.svelte` and `details/+page.svelte`), no login needed.
3. They send `POST /hotelA/management/settings/rates/<hotelB-plan-id>?/addOverride` with `date=2026-12-24&pricePhp=1`.
4. The row is inserted. Because the table's unique key is `(rate_plan_id, date)` and the insert uses `onConflictDoUpdate` (line 192), an existing Hotel B override for that date is **overwritten**.
5. Hotel B's guests are now quoted ₱1.00 for that night. A large `pricePhp` (or a `addSeason` with a multiplier) does the opposite and makes Hotel B's rooms unbookable.

#### Impact
- **Integrity:** an outside admin can set another hotel's prices — revenue loss, or a booking rush at ₱1.
- **Cannot be cleaned up by the victim:** `removeOverride` / `removeSeason` delete `where id = ? AND hotel_id = <victim>`. The planted rows carry **Hotel A's** `hotel_id`, so Hotel B's admin cannot delete them from their own settings screen.
- **Hard to spot:** the audit entry is recorded under Hotel A, not Hotel B.
- Confidentiality is not affected (this is a write, not a read).

#### Verified by
Read both actions and `load`; grepped every reader of `dailyRates` / `seasonalRates` and confirmed none filter by hotel. **Not** exploited live.

#### Recommended fix
Add one shared guard, and call it at the top of `addOverride`, `addSeason` (and, for defence in depth, `update`):

```ts
async function assertPlanBelongsToHotel(ratePlanId: string, hotelId: string) {
	const [plan] = await db
		.select({ id: ratePlans.id })
		.from(ratePlans)
		.where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.hotelId, hotelId)))
		.limit(1);
	if (!plan) error(404, 'Rate plan not found');
}
```

Also harden the readers so a bad row can never price another hotel: in `pricing.ts` and `booking-modify.ts`, add `eq(dailyRates.hotelId, hotelId)` / `eq(seasonalRates.hotelId, hotelId)` (or join through `rate_plans.hotel_id`).

#### Data cleanup after the fix
Find rows already planted: rows where the row's `hotel_id` differs from the owning plan's `hotel_id`:

```sql
select d.id, d.hotel_id as row_hotel, p.hotel_id as plan_hotel, d.rate_plan_id, d.date, d.price_centavos
from daily_rates d join rate_plans p on p.id = d.rate_plan_id
where d.hotel_id <> p.hotel_id;
-- same for seasonal_rates
```

#### Tests to add
- Admin of hotel A calling `addOverride` / `addSeason` with hotel B's plan ID → 404, no row written.
- Same call with own plan ID still works.
- Pricing for a plan ignores a `daily_rates` row whose `hotel_id` does not match the plan's hotel.

---

## RATES-002
### 🟡 Medium — Promo codes have no usage limits and no guess protection

**Type:** Business-logic abuse; brute force
**Files:** `lib/server/db/schema/promo-codes.ts` (no limit columns), `lib/server/promo-codes.ts:20` (`findRedeemablePromoCode`), `(guest)/details/+page.server.ts:244` (redemption), `settings/rates/+page.server.ts:137-141` (code and percent validation)

#### What is wrong
Three separate gaps combine:

1. **Unlimited reuse.** `promo_codes` has no maximum-uses, per-guest limit, or one-time flag. Once a code is valid, anyone who knows it can use it on every booking, forever, until the admin manually deactivates it or it expires.
2. **No guess protection.** `findRedeemablePromoCode` is called from the public checkout with no rate limit or lockout, and it deliberately returns the same "isn't valid" error for every failure (good), but nothing slows repeated tries. Codes may be as short as **2 characters** (`min(2)` at line 137), so short codes are guessable by script.
3. **100% off is allowed.** `discountPct` accepts up to `max(100)` (line 141). A 100% code produces a ₱0 booking. It was **not verified** whether the PayMongo step handles a ₱0 total gracefully or lets the booking through unpaid.

#### Attack / abuse scenarios
- A code shared in a private message or a "members only" email leaks to a coupon site → unlimited discounted bookings.
- A script tries short codes against `/details` until one hits.
- A staff typo (`100` instead of `10`) creates a free-stay code with no cap on how many can be redeemed.

#### Impact
Revenue loss and uncontrolled discounting. Cannot expose other hotels' data (the lookup is scoped by `hotelId`).

#### Verified by
Read the schema, lookup, checkout redemption, and admin validation. Confirmed no limit fields exist and no throttle is applied in the checkout action. ₱0-total behaviour **not** tested.

#### Recommended fix
- Add `maxRedemptions`, `maxPerGuestEmail` (optional), and a count check **inside the same transaction** that inserts the redemption, so two simultaneous checkouts can't both take the last use.
- Throttle promo attempts per IP and per hotel, reusing the existing limiter in `lib/server/auth/rate-limit.ts`.
- Require a minimum code length of 6 and reject codes made of guessable words.
- Cap percentage codes at a sensible ceiling (e.g. 90%) or require an explicit "allow 100%" confirmation, and confirm the ₱0 path in `createOrder` / `pay`.

#### Tests to add
- A code with `maxRedemptions = 1` rejects the second checkout.
- Concurrent redemptions cannot exceed the limit.
- More than N failed attempts from one IP are throttled.

---

## RATES-003
### 🟡 Medium — Rate plans can reference another hotel's room type and policies

**Type:** Broken access control — cross-tenant reference
**Files:** `settings/rates/+page.server.ts` — `createRatePlan` (lines 334-336); `settings/rates/[ratePlanId]/+page.server.ts` — `update` (lines 156-157)

#### What is wrong
`roomTypeId`, `cancellationPolicyId` and `securityDepositPolicyId` are validated only as "a UUID". The actions never confirm those IDs belong to the caller's hotel before saving them onto the rate plan. Foreign-key constraints only check that the row *exists*, not whose it is.

#### Impact (lower than RATES-001)
- **No cross-tenant harm to the other hotel's prices.** Rate plan listings are filtered by hotel (`availability.ts:318, 328, 488`), so a plan that points at another hotel's room type simply never shows for that hotel — it becomes an orphan under the attacker's own hotel.
- **Small information leak:** `availability.ts:326-328` joins the plan to the cancellation policy by ID with no hotel check, so if a plan is pointed at another hotel's policy, the attacker's guests are shown that hotel's cancellation terms and downpayment percentage. Needs the other hotel's policy UUID.
- **Integrity of the attacker's own data:** dangling references can break the attacker's own room lists.
- It also means the ownership rule the app relies on ("every tenant row carries a matching `hotel_id`") is not actually enforced at the write boundary.

#### Verified by
Read the create and update actions and the availability joins. Not exploited live.

#### Recommended fix
Before saving, confirm each supplied ID belongs to `hotelId`:

```ts
const owned = await db.select({ id: cancellationPolicies.id }).from(cancellationPolicies)
	.where(and(eq(cancellationPolicies.id, id), eq(cancellationPolicies.hotelId, hotelId))).limit(1);
if (!owned.length) return fail(400, { error: 'Choose a policy from this hotel.' });
```

Repeat for room type and security-deposit policy. A small shared helper keeps this in one place, and the RATES-001 guard can live next to it.

#### Tests to add
- Creating or updating a plan with another hotel's room type / policy ID → rejected.

---

## RATES-004
### 🟢 Low — No upper bound on any money field; `Infinity` crashes the save

**Type:** Input validation
**Files:** `settings/rates/+page.server.ts:105` (deposit `amountPhp`), `:129` (`basePricePhp`), `:111` (`optMoney`, used for extra-person and extra-bed fees, and fixed promo amount); `settings/rates/[ratePlanId]/+page.server.ts:26, 84, 99, 108` (base price, override price, seasonal price, extra fees)

#### What is wrong
Every money field is `z.coerce.number().min(0)` with **no `.max()`** and no `.finite()`.

- A typo like `50000000` is accepted and saved as a real price.
- `Infinity` passes validation, then `Math.round(Infinity * 100)` cannot be stored in a bigint column → the request fails with a server error instead of a friendly message.
- Extremely large finite values can overflow the database column or JavaScript's safe-integer range.

#### Impact
Admin-only and no cross-tenant effect. Realistic risk is a bad price going live from a typo, or an unhandled 500 error. (The check-in/out fees at `check-in-out/+page.server.ts:24-25` **do** have `.max(1_000_000)`, which shows the intent — the rates pages just never got it.)

#### Recommended fix
Define one shared money schema and use it everywhere:

```ts
const money = (maxPhp = 1_000_000) => z.coerce.number().finite().min(0).max(maxPhp);
```

Show a specific message ("Enter an amount up to ₱1,000,000") instead of the generic "Check the … and try again."

#### Tests to add
`Infinity`, `1e30`, negative, and `NaN` all return a 400 with a readable error.

---

## RATES-005
### 🟢 Low — Impossible times accepted for check-in / check-out

**Type:** Input validation
**File:** `settings/check-in-out/+page.server.ts:22-23`

`z.string().regex(/^\d{2}:\d{2}$/)` matches the *shape* only, so `99:99` or `25:61` passes validation and fails at the database (time column) with a server error.

**Fix:** validate the range, e.g. `/^([01]\d|2[0-3]):[0-5]\d$/`.
**Test:** `24:00`, `99:99`, `12:60` rejected; `00:00`, `23:59` accepted.

---

## RATES-006
### 🟢 Low — Malformed IDs on delete actions cause server errors

**Type:** Input validation / error handling
**File:** `settings/rates/[ratePlanId]/+page.server.ts:218` (`removeOverride`), `:277` (`removeSeason`)

`id` is only checked for being non-empty, then passed to a query against a `uuid` column. A non-UUID value (`abc`) makes Postgres reject the query and the request returns a 500 instead of a clean "not found."

**Fix:** `z.string().uuid()` on `id`; return 400 for anything else.

---

## RATES-007
### 🟢 Low — Rate plan update writes an audit entry even when nothing changed

**Type:** Audit integrity
**File:** `settings/rates/[ratePlanId]/+page.server.ts:141-170` (`update`)

The update is scoped by hotel (`where id and hotelId`) so it cannot change another hotel's plan, but it never checks that a row was updated. A request for a plan that isn't yours (or doesn't exist) still writes a `rate_plan.update` audit entry with the submitted values and returns "Rate plan updated." This makes the audit log misleading.

**Fix:** use `.returning({ id })`, and return 404 (and skip the audit write) when no row comes back. The RATES-001 guard covers this once applied to `update` too.

---

## RATES-008
### 🟡 Medium — Promo discount does not reduce the VAT shown on invoices

**Type:** Tax accuracy / accounting (not an access-control issue)
**Files:** `(guest)/details/+page.server.ts` (discount applied at checkout, ~lines 232-260 and 340-360), `lib/server/finance/documents.ts` (`buildInvoiceSnapshot`, VAT recovery from the booking row)

#### What is wrong
At checkout the promo discount is taken off the room's **VAT-inclusive total** and subtracted from `bookings.subtotal_centavos` and `bookings.total_centavos`, but `bookings.vat_centavos` is **left at its original, pre-discount value**. The invoice then reads VAT straight from that column, so the printed VAT does not shrink when a discount is given.

#### Real example (order `C7FB25D1`, promo `TEST10`, 10% off)
| Figure | Stored / printed |
|---|---|
| Price before promo (gross) | ₱36,960.00 |
| Promo discount | −₱3,696.00 |
| **Total charged** | **₱33,264.00** |
| Room subtotal after promo | ₱29,304.00 |
| **VAT printed on the invoice** | **₱3,960.00** (12% of the original ₱33,000.00) |

If the discount is treated as a reduction of the sale — the usual treatment for a discount shown on the invoice — VAT would be about ₱3,564.00 (₱3,960.00 × 90%), so the invoice over-states VAT by roughly **₱396.00** on this booking, and the VATable-sales figure is inconsistent with it (₱3,960.00 is not 12% of ₱29,304.00 or of any sales figure shown).

#### Impact
- The guest pays the same either way; the effect is on the **hotel's VAT reporting** (VAT output declared is higher than it should be, on every promo booking).
- Scales with promo usage; unbounded promo reuse (RATES-002) makes it larger.
- Not visible on screen for the guest, but visible to an auditor comparing VATable sales × 12% against VAT.

#### Verified by
Read the checkout discount code and the invoice snapshot builder; confirmed against the stored booking row for `C7FB25D1` (subtotal 2,930,400, fees 0, VAT 396,000, discount 369,600, total 3,326,400 centavos). The invoice printing itself was checked through the snapshot builder only — no invoice was issued.

#### Recommended fix
**Needs the hotel's accountant to confirm the treatment first** — whether promo discounts are pre-VAT (reduce the taxable base) or a post-tax rebate. If pre-VAT (recommended by the printed-discount approach already used on the invoice):
- Apply the discount **before** VAT at checkout: discount the subtotal, then compute VAT and fees on the discounted amount, so `subtotal + fees + vat = total` and `vat = 12% × vatable sales`.
- Keep `bookings.discount_centavos` as the audit figure, and `promo_redemptions` unchanged.
- Existing promo bookings keep their old figures; decide whether to correct them or annotate.

#### Tests to add
- A percentage promo on a VAT-registered hotel: `vat` equals 12% of `subtotal + fees` after discount, and the three sum to the total.
- Invoice VATable sales × rate ≈ VAT for a promo booking.

---

## Controls that are working

Reviewed and found sound — no action needed:

- **Every action enforces `hotel:admin`** via `requireCap` (rates page, rate-plan page, check-in/out page, all create/update/add/remove actions).
- **Most writes and deletes are scoped by hotel:** policy updates, promo-code updates, `removeOverride`, `removeSeason`, and the rate-plan `update` all include `hotelId` in the `where`.
- **The rate-plan page `load` verifies ownership** before showing anything (line 36).
- **CSRF:** `svelte.config.js` does not disable SvelteKit's default origin check for form posts.
- **Promo lookup is hotel-scoped and non-revealing:** `findRedeemablePromoCode` filters by `hotelId` and returns the same failure for every reason.
- **Audit entries** are written for every change and do not contain secrets.
- **Promo code uniqueness** is enforced per hotel by a unique index and reported clearly on conflict.

## Out of scope (not reviewed)

Guest checkout flow beyond the promo lookup, PayMongo payment handling, other settings pages (branding, rooms, dining, payments-email), and infrastructure/deployment configuration.

## Change log

| Date | Note |
|---|---|
| 2026-09-30 | Initial review; 7 findings recorded, none fixed. |
| 2026-09-30 | Added RATES-008 (promo discount vs VAT) after adding the promo trail to the Booking Transactions page and printed invoice. |
