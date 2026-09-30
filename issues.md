# Security & Integrity Issues — Settings › Rates & Policies

| | |
|---|---|
| **Scope** | Staff settings for rate plans, price overrides, seasonal rates, cancellation policies, security-deposit policies, promo codes, and check-in/check-out policy |
| **Reviewed** | 2026-09-30 |
| **Method** | Manual code review (read-only). Data flow traced from form → validation → database → consumer. |
| **Not done** | None of the findings below were exploited against a running instance, and no database rows were changed. Every "Verified by" line says what was actually read. |
| **Status** | **RATES-001 → 007 Resolved** (2026-09-30, Jade). **RATES-008 remains Open** — it needs an accountant's decision first. |
| **Main review** | Blocks marked **`[main]`** were added on **main** (2026-09-30) after checking each finding against the code. Jade's original text is unchanged. Read-only: no code was modified and no data changed. |

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

| ID | Severity | Title | Type | Status |
|---|---|---|---|---|
| [RATES-001](#rates-001) | 🔴 **High** | Price overrides and seasonal rates can be written to another hotel's rate plan | Broken access control (cross-tenant IDOR) | ✅ Resolved |
| [RATES-002](#rates-002) | 🟡 Medium | Promo codes have no usage limits and no guess protection | Business-logic abuse / brute force | ✅ Resolved |
| [RATES-003](#rates-003) | 🟡 Medium | Rate plans can reference another hotel's room type and policies | Broken access control (cross-tenant reference) | ✅ Resolved |
| [RATES-004](#rates-004) | 🟢 Low | No upper bound on any money field; `Infinity` crashes the save | Input validation | ✅ Resolved |
| [RATES-005](#rates-005) | 🟢 Low | Impossible times accepted for check-in / check-out | Input validation | ✅ Resolved |
| [RATES-006](#rates-006) | 🟢 Low | Malformed IDs on delete actions cause server errors | Input validation / error handling | ✅ Resolved |
| [RATES-007](#rates-007) | 🟢 Low | Rate plan update writes an audit entry even when nothing changed | Audit integrity | ✅ Resolved |
| [RATES-008](#rates-008) | 🟡 Medium | Promo discount does not reduce the VAT shown on invoices | Tax accuracy (needs accountant decision) | ⏳ Open |

Suggested fix order: **001 → 003 → 002 → 008 (after accountant sign-off) → 004 → 005/006/007**.

### `[main]` verdicts at a glance

| ID | Real lapse? | Severity per main | Solution needed |
|---|---|---|---|
| RATES-001 | **Yes — confirmed** | 🔴 High (agree) | Ownership guard on `addOverride` / `addSeason` / `update`, **plus** hotel filter in the pricing readers, plus cleanup query |
| RATES-002 | **Yes — confirmed** (caveat: ₱0 path unverified) | 🟡 Medium (agree) | Redemption limits (atomic), throttle, longer min code, cap % |
| RATES-003 | **Yes — confirmed** | 🟢–🟡 Low–Medium (main would downgrade) | Verify room type + both policy IDs belong to the hotel |
| RATES-004 | **Yes — confirmed** | 🟢 Low (agree) | One shared finite, capped money schema |
| RATES-005 | **Yes — confirmed** | 🟢 Low (agree) | Range-check the time regex |
| RATES-006 | **Yes — confirmed** | 🟢 Low (agree) | `z.string().uuid()` on delete `id`s |
| RATES-007 | **Yes — confirmed** (polish, not security) | 🟢 Low (agree) | Check the row count, 404 + skip audit |
| RATES-008 | **Yes — confirmed in code**, treatment needs accountant | 🟡 Medium (agree) | Accountant sign-off first, then discount before VAT |

---

## RATES-001
### 🔴 High — Price overrides and seasonal rates can be written to another hotel's rate plan

> **`[main]` review — confirmed, a real lapse.**
> - Re-checked in code: `addOverride` and `addSeason` take `ratePlanId` from the URL and never check it belongs to the caller's hotel; `pricing.ts` and `booking-modify.ts` read `daily_rates` / `seasonal_rates` by plan ID only; rate plan IDs do reach the public rooms page; the unique index `(rate_plan_id, date)` enables the overwrite. It also breaks our own rule (CLAUDE.md): every query scopes by `hotel_id`.
> - **Corrections to the text above:**
>   - "Hard to spot" is overstated — the rate-plan page lists overrides by plan ID only, so the **victim's admin can see** the planted rows. The audit entry is still under the attacker's hotel.
>   - "Cannot be cleaned up": the victim sees the row but **Remove can't delete it** (delete is scoped by `hotel_id`), and the toast still says "Override removed" — misleading.
>   - When an existing row is **overwritten**, it keeps the victim's `hotel_id`, so it is deletable, but the original price is already lost.
> - **Solution needed:** (1) ownership guard at the top of `addOverride`, `addSeason`, and `update`; (2) add the hotel filter to the readers in `pricing.ts` and `booking-modify.ts` (defence in depth); (3) run the cleanup query on every real database, not only dev; (4) the three tests listed below; (5) sweep other actions that take an ID from the URL — 001, 003 and 006 share the same habit.

> **✅ Resolved — Jade, 2026-09-30.** Implements every item in the `[main]` "solution needed" list.
> - **(1) Ownership guard.** New `assertRatePlanInHotel` (`lib/server/rate-plans.ts`) is called at the top of `addOverride`, `addSeason` **and** `update` in `settings/rates/[ratePlanId]/+page.server.ts`; another hotel's plan now returns a 404 and nothing is written.
> - **(2) Hotel filter in the readers.** `pricing.ts` (`priceStay`) and `booking-modify.ts` (`priceNights`) now filter `daily_rates` / `seasonal_rates` by `hotel_id` as well as plan id, so a row written under another hotel can never price this one. The rate-plan page's own override/season lists use the same filter (so an admin no longer sees rows that have no effect).
> - **(3) Cleanup query.** Run on Jade's dev database → **0 planted rows** (daily and seasonal). It still has to be run on **every real database** before release; the query is in the section below.
> - **(4) Tests** (`lib/server/rate-plans.test.ts`, live DB, throwaway hotels): the guard accepts an own plan and rejects another hotel's / a missing one; pricing ignores a daily override and a seasonal rate planted under another hotel; a hotel's own override still applies. Each test was checked by temporarily removing the fix — the pricing tests fail without the hotel filter.
> - **(5) Sweep of other ID-taking actions** — found and fixed one more case of the same habit: the room-type `update` action (`settings/rooms/types/[roomTypeId]/+page.server.ts`) wrote its room type hotel-scoped, but then deleted and re-inserted the room type's **amenity links keyed by room-type id alone**, so an admin of another hotel could wipe and rewrite them. It now checks ownership first (404) and the delete is scoped by `hotel_id`. Dining, function-hall, room-unit and the other room-type actions were checked and already scope every write by hotel.
> - **Corrections from `[main]` addressed:** `removeOverride` / `removeSeason` now delete with `.returning()` and answer **404 "not found"** instead of a false "Override removed" when nothing was deleted.

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

> **`[main]` review — confirmed, with one unverified point.**
> - Re-checked: no limit columns exist; the 2-character minimum is real; 100% is accepted; the only rate limiters in the app are on login, invite and API-key paths, **never on guest checkout**.
> - The lack of throttling was a **deliberate choice** (see the comment in `promo-codes.ts`), but it only considered hidden inventory — not guessing a code to get a discount. That is the lapse.
> - **Not verified:** the ₱0 path. A 100% code sends zero-amount line items to PayMongo, which most likely rejects it — leaving a pending order that holds inventory until it expires, rather than a free stay. Needs a test before we rely on this.
> - **Solution needed:** `maxRedemptions` (and optional per-email limit) enforced **inside the same transaction** as the redemption insert; a throttle on promo attempts per IP and hotel reusing `auth/rate-limit.ts`; minimum code length 6; cap percentage codes (or explicit "allow 100%"); test the ₱0 path end to end.

> **✅ Resolved — Jade, 2026-09-30**, with the deviations and limits listed below.
> - **Redemption limits, atomic.** New nullable columns `promo_codes.max_redemptions` and `max_per_email` (migration `0060_promo_limits`; existing codes stay unlimited). `assertPromoWithinLimits` (`lib/server/promo-codes.ts`) runs **inside the checkout transaction**: it locks the code's row (`FOR UPDATE`), then counts uses, so two simultaneous checkouts cannot both take the last one. A "use" is one order (a multi-room order counts once); cancelled/expired orders and voided redemptions give the use back; the per-email check is case-insensitive.
> - **Throttle.** New `promoGuessByIp` limiter (`auth/rate-limit.ts`, reusing the same `RateLimiter`): 8 **failed** promo tries per 15 minutes per hotel + IP, then a 429 "Too many attempts" message. Only failures count and a success never resets it (so a known-good code can't be used to clear the counter). A code that exists but is used up counts as a failure and shows the same generic "isn't valid" message, so it never confirms the code exists.
> - **Minimum length 6** for new and edited codes (`PROMO_MIN_CODE_LENGTH`).
> - **Percentage cap 90%** (`MAX_PROMO_PERCENT`) — chosen over an explicit "allow 100%" switch; the form's input `max` and helper text match.
> - **₱0 path.** Checkout now refuses any code whose discount would cover the whole order (`total − discount ≤ 0`, checked before anything is saved), so a zero-amount order can no longer reach the payment provider. This closes the one route left after the cap (a flat amount ≥ the total).
> - **Admin form:** "Max total uses" and "Max uses per guest email" fields on the create and edit dialogs, and the limits shown in the promo list.
> - **Tests:** live-DB tests for the limit, multi-room counting, cancelled/voided orders, per-email (case-insensitive) and a **race test where two checkouts compete for the last use — exactly one wins**; unit tests for `computePromoDiscountCentavos`. The race test fails if the row lock is removed.
> - **Not verified / limits:** how PayMongo itself answers a ₱0 request was **not** tested (it is now prevented rather than handled). The throttle is in-memory like the login limiter — a restart clears it and separate app instances don't share counts. Existing codes shorter than 6 characters keep working at checkout, but the edit form will ask for a longer code before saving.

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

> **`[main]` review — confirmed, but main would rate it Low–Medium.**
> - Re-checked: neither `createRatePlan` nor `update` verifies the room type or policy IDs belong to the hotel.
> - The harm lands almost entirely on the **attacker's own hotel**. The leak is narrower than described: the availability join exposes only `freeCancelHours`, `penaltyType` and the downpayment percentage — not the policy name or text — and it needs the other hotel's policy UUID, which we saw no sign of being public.
> - Still worth fixing: it violates the "every tenant row carries a matching `hotel_id`" rule at the write boundary.
> - **Solution needed:** one small shared helper that checks room type, cancellation policy and security-deposit policy all belong to `hotelId`, used by both actions; the RATES-001 guard can live beside it; test for rejection.

> **✅ Resolved — Jade, 2026-09-30.** New helper `assertPlanRefsInHotel` (`lib/server/rate-plans.ts`) checks the room type, cancellation policy and security-deposit policy all belong to the hotel. It is used by **both** `createRatePlan` (`settings/rates/+page.server.ts`) and the rate-plan `update` action; a foreign id is rejected with "Choose a … from this hotel." and nothing is saved. Blank references still mean "none". Tests (live DB) cover each of the three references being rejected, own ones accepted, and blanks skipped.

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

> **`[main]` review — confirmed.** No money field has `.max()` or `.finite()`; the check-in/out fees already cap at 1,000,000, so the rates pages simply missed it. **Solution needed:** one shared finite, capped money schema used by every rates field (including the deposit, extra-fee and promo amount fields), with a readable error message.

> **✅ Resolved — Jade, 2026-09-30.** One shared schema, `moneyPhp()` / `optMoneyPhp` (`lib/rate-validation.ts`): a number from 0 to **₱1,000,000** with a readable message ("Enter an amount up to ₱1,000,000." / "Amounts can't be negative." / "Enter a valid amount."). It replaces every money field on the rates pages: base price, weekend price, extra person / child / bed fees, security-deposit amount, promo fixed amount, daily override price and seasonal price. The failure messages now reach the admin instead of the generic "Check … and try again."
> - **Correction to the finding above:** the project uses **zod 4, which already rejects `Infinity` and `NaN`** (confirmed by test), so "`Infinity` crashes the save" was not accurate here. The real gap was the missing upper bound: `1e30` passed validation and overflowed the bigint column. That is what is fixed.
> - Tests: accepts normal amounts, `0` and the cap; rejects `1000000.01`, `50000000`, `1e30`, `1e308`, negatives, `Infinity` and text, each with the right message.

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

> **`[main]` review — confirmed.** The regex checks shape only. Nuance: Postgres accepts `24:00` as a valid time, so that value would not crash — rejecting it is an app-policy choice, not a bug fix. **Solution needed:** range-check the regex as suggested.

> **✅ Resolved — Jade, 2026-09-30.** Check-in and check-out times use `timeOfDay()` (`/^([01]\d|2[0-3]):[0-5]\d$/`) in `settings/check-in-out/+page.server.ts`, with the message "Enter a valid time between 00:00 and 23:59." Rejects `99:99`, `25:00`, `12:60`, `1:30` and `12:00:00`. As `[main]` noted, Postgres accepts `24:00`, so rejecting it is an app-policy choice; the time picker never produces it anyway. Unit-tested.

**Type:** Input validation
**File:** `settings/check-in-out/+page.server.ts:22-23`

`z.string().regex(/^\d{2}:\d{2}$/)` matches the *shape* only, so `99:99` or `25:61` passes validation and fails at the database (time column) with a server error.

**Fix:** validate the range, e.g. `/^([01]\d|2[0-3]):[0-5]\d$/`.
**Test:** `24:00`, `99:99`, `12:60` rejected; `00:00`, `23:59` accepted.

---

## RATES-006
### 🟢 Low — Malformed IDs on delete actions cause server errors

> **`[main]` review — confirmed.** Only an empty check before the query; a non-UUID reaches a `uuid` column and returns a 500. Not exploitable. **Solution needed:** `z.string().uuid()` on both delete actions; while there, check other `remove*` / `delete*` actions in the settings pages for the same pattern.

> **✅ Resolved — Jade, 2026-09-30.** `removeOverride` and `removeSeason` now validate the posted id with `recordId()` (`z.string().uuid()`) and return a clean 400 instead of a 500. **Sweep of other remove/delete actions in settings:** the amenities actions already validated UUIDs; the team page's `revokeInvite` only checked "is a string" and now checks for a UUID too (it was already hotel-scoped); the dining, function-hall and room pages take their ids from the route and every write is scoped by hotel.

**Type:** Input validation / error handling
**File:** `settings/rates/[ratePlanId]/+page.server.ts:218` (`removeOverride`), `:277` (`removeSeason`)

`id` is only checked for being non-empty, then passed to a query against a `uuid` column. A non-UUID value (`abc`) makes Postgres reject the query and the request returns a 500 instead of a clean "not found."

**Fix:** `z.string().uuid()` on `id`; return 400 for anything else.

---

## RATES-007
### 🟢 Low — Rate plan update writes an audit entry even when nothing changed

> **`[main]` review — confirmed, but closer to polish than security.** The update is hotel-scoped, so no other hotel's data changes; the only effect is a misleading audit entry and success message in the caller's own hotel. **Solution needed:** `.returning({ id })`, 404 and skip the audit write when nothing matched. Falls out of the RATES-001 guard once that is applied to `update`.

> **✅ Resolved — Jade, 2026-09-30.** The rate-plan `update` now runs an ownership check first and uses `.returning({ id })`; if no row matched it returns a 404 and writes **no** audit entry and no success message. The same `.returning()` check was applied to `removeOverride` / `removeSeason` (see RATES-001).

**Type:** Audit integrity
**File:** `settings/rates/[ratePlanId]/+page.server.ts:141-170` (`update`)

The update is scoped by hotel (`where id and hotelId`) so it cannot change another hotel's plan, but it never checks that a row was updated. A request for a plan that isn't yours (or doesn't exist) still writes a `rate_plan.update` audit entry with the submitted values and returns "Rate plan updated." This makes the audit log misleading.

**Fix:** use `.returning({ id })`, and return 404 (and skip the audit write) when no row comes back. The RATES-001 guard covers this once applied to `update` too.

---

## RATES-008
### 🟡 Medium — Promo discount does not reduce the VAT shown on invoices

> **`[main]` review — confirmed in code; the correct treatment needs an accountant.**
> - Re-checked: in `details/+page.server.ts` the **booking** rows subtract the discount from `subtotal` and `total` but leave `vat` at its full value, and `documents.ts` sums `bookings.vat_centavos` onto the invoice. That also contradicts the code's own comment (a few lines above) that subtotal/fees/VAT stay undiscounted — the **order** row does that, the **booking** rows do not. The two levels are inconsistent.
> - The worked example's arithmetic is internally correct (33,000 + 3,960 = 36,960; 10% = 3,696; 29,304 subtotal; 33,264 total; VAT unchanged at 3,960).
> - **Not verified:** the stored figures for order `C7FB25D1` — that order is not in main's dev database (it was in Jade's). The code path reproduces the behaviour.
> - **Solution needed:** (1) an accountant decides whether a promo discount reduces the taxable base; (2) if yes, discount before VAT at checkout so `vat = rate × vatable sales` and the parts sum to the total; (3) decide whether to correct or annotate existing promo bookings; (4) the two tests listed below.

> **⏳ Still Open — not implemented.** `[main]` marked this as needing an accountant's decision first (does a promo discount reduce the taxable base?), so no code was changed. Once that is decided, the fix is to discount before VAT at checkout as described below, and to decide whether existing promo bookings are corrected or annotated.

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
| 2026-09-30 | **`[main]`** reviewed all 8 findings against the code: all confirmed as real lapses. Added a verdict table and a `[main]` comment + "solution needed" block under each finding. RATES-003 suggested Low–Medium; corrections noted on RATES-001. No code changed. |
| 2026-09-30 | **Jade** implemented the `[main]`-approved solutions for RATES-001 → 007 and marked them **Resolved**. RATES-004's `Infinity` claim corrected (zod 4 already rejects it; the real gap was the missing upper bound). The RATES-001 sweep found and fixed one more cross-hotel write (room-type amenity links). Migration `0060_promo_limits` added. RATES-008 left Open pending accountant sign-off. |
