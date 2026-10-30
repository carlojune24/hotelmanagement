# OTA (Agoda) channel bookings — plan

Status: v1 built 2026-10-30, not browser-tested, not committed. Server: `ota` columns on `orders` (migration 0107), `createWalkInBooking({ota})`, `cancelOtaBooking`, `finance/ota.ts` `recordOtaPayout`, tests in `ota-booking.test.ts`. UI: OTA mode in the front-desk walk-in drawer, Finance → OTA payouts tab, OTA cancel/no-show on the reservation page. Code-checked 2026-10-30. The client confirmed **every OTA booking is already
prepaid at the OTA** (Agoda Collect model): the OTA pays the hotel later, net of commission.

## Context

The client lists the hotel on Agoda. Those bookings must be re-entered here, because inventory,
housekeeping and the front desk all run from this app, and Agoda doesn't see our inventory.
Today `BookingChannel` is only `online | walkin` (`apps/hotel/src/lib/booking-payment-status.ts`).

The OTA typically pays 30–60 days later, net of commission. Entering these as normal paid bookings would
book cash that never arrived and break the cash-basis finance module (`recordCashMovement` is the single
cash choke point). Pay at Hotel and virtual-credit-card bookings are out of scope for v1.

## Decisions

- **Multiple OTAs from v1, from a configured list.** Hotel admins manage the OTAs in Settings → OTA channels
  (add, rename, turn off, never delete). Staff pick one in a dropdown: no typing, so one OTA is never spelt two
  ways. The server refuses any name not on the active list. Renaming carries through to bookings and ledger
  accounts. The OTA reference is unique per hotel + OTA. (An earlier draft used free text with suggestions; typos
  would have split one OTA into several and made payouts hard to assign.)
- **Net revenue basis.** Revenue reported is what the OTA actually pays (the net). Commission is not its own
  report line in v1. Gross, commission and net are still stored on each booking, so a commission line can be
  added later with a one-off backfill.
- **Payout matching by hand** in v1: Finance → OTA payouts has one tab per OTA; staff tick the bookings that OTA's
  statement covers (search by guest, reference or code). One payout covers one OTA. Statement import deferred.
- **No payment-mode field** on the form: every OTA booking is an OTA receivable.

## Accounting design

Booking time: no cash, no journal entry. The folio is squared by `openReceivable` (a `house_use` payment,
no cash movement); the receivable carries the **gross**.

Payout, per ticked booking:

1. `settleReceivable` for the **net received** (editable, prefilled with the booking's expected net). It books
   the cash-in as `room_revenue` (`finance/receivables.ts:205`) through `recordCashMovement`.
2. `writeOffReceivable` for the remainder (gross minus net received), reason "OTA commission — <statement ID>".
   A write-off posts nothing (`receivables.ts` doc comment), so there is no journal entry to add.
   Skip the write-off when the remainder is zero.

A short-paid payout needs no extra logic: staff type the lower net, and the larger remainder is written off
with a note. Existing functions are reused unchanged, so no new accounting code.

shortcut: settle and write-off are two transactions, not one. If the write-off fails the receivable stays
`partial` and the payout can be retried. Combine them if that ever happens in practice.

## Plan (v1)

1. **Schema.** On `orders`: `ota_name`, `ota_reference` (unique per hotel + OTA), `ota_gross_centavos`,
   `ota_commission_centavos`, `ota_net_centavos`. Channel is derived today (`booking-transactions.ts:217`,
   `transactions/[orderId]/+page.server.ts:454`), so add `ota` to `BookingChannel` and make both derivations
   read the stored column first. `CHANNEL_LABEL` (`Record<BookingChannel,string>`), `SOURCE_FILTERS` and the
   badge in `transactions/+page.svelte:259` must be updated. Payment state is computed
   (`summariseBookingPayment`), so `ota_receivable` is a new computed state, not a stored one. Migration:
   `pnpm db:generate` / `pnpm db:migrate` (currently up to `0106`).
2. **Booking creation.** Do not duplicate `createWalkInBooking` (`front-desk.ts:844`). Give it two optional
   inputs: no payment (skips `recordWalkInPayment`), and a trusted total that skips server-side repricing
   (an OTA booking carries the OTA's price, not our rate plan). Then call `openReceivable` for the gross.
   `openReceivable` opens its own transaction; give it an optional `tx` so the booking and its receivable are
   atomic. Guest email is `notNull` (`schema/bookings.ts:32`): store `ota-<ref>@invalid` when the OTA gives
   none. Staff form: run `impeccable` first (CLAUDE.md), shadcn operate mode, no PayMongo. Captures guest,
   rooms, dates, OTA, reference, gross, commission %, net.
3. **Check-out.** No special case: the receivable squares the folio, so `checkOutBooking`
   (`front-desk.ts:1166`) passes its balance gate. Verify with a test, not by assumption.
4. **Cancellation / no-show.** Add `cancelOtaBooking`: flips the status (frees the room), closes the
   receivable with `writeOffReceivable`, reason "cancelled at OTA", no refund. No-show uses the same path.
   Guard `cancelBooking` (`cancellation.ts:405`) and `markNoShow` (`:813`) so an OTA booking cannot enter the
   refund flow; the cancel dialog offers the OTA action instead.
5. **OTA receivables tab and payout.** Add a tab in `finance/+layout.svelte:9-26`: open receivables whose
   order has an `ota_name`, grouped by OTA. "Record payout": tick bookings, enter statement ID and the net
   received per booking, then run the two payout steps above.

## Phase 2 (not v1)

- Gross plus commission report line (needs an `ota_payouts` table or a journal entry crediting 4010; backfill
  from the stored `ota_*` columns).
- Channel and occupancy split in `daily-stats.ts` and its consumers (`lib/server/api/daily-stats.ts`,
  `routes/api/v1/stats/daily`). Not sized; no channel dimension exists today.
- Editing an OTA booking after creation (Agoda changes dates or rate).
- Settings-managed OTA name list; iCal or channel-manager sync; statement import for payout matching.

## Open questions

- Confirm the owner is fine with no commission line in the finance reports for v1.

## Verification

- Unit: payment state for the `ota` channel.
- DB tests (`describe.skipIf(!hasDb)`): a payout books one cash movement per ticked booking for the net and
  closes each receivable; `cash_accounts.current_balance_centavos` moves only by the net, only on payout;
  a short-paid payout writes off the larger remainder.
- Regression: city-ledger `openReceivable` with the new `tx` parameter; ordinary check-out unchanged.
- `pnpm ledger:check`.
- Manual: create an OTA booking and confirm no cash movement; check in and out; cancel one; record a payout
  and confirm the cash movement and the closed receivable.

## Not checked

`daily-stats.ts` consumers, the front-desk list's channel filter, the reconciliation page, the
`ledger:check` script, and `recordWalkInPayment` internals.
