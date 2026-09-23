# PayMongo end-to-end test plan

Sign-off for Phase 1: a guest books and pays online, staff run the stay, and every peso and
document reconciles. Run **Part 1 in test mode now**; run **Part 2 once PayMongo is live**.
Record each run in the Results column (date + pass/fail + note).

**How a run works:** you do the clicking (guest site in one window, staff app in another);
after each case Claude checks the database, webhook deliveries, `email_log` and the issued
documents, and marks pass/fail. Nothing automated drives your browser.

## Before any run

| Check | How |
|---|---|
| Dev server + tunnel running, `ORIGIN` = current tunnel URL | `.env`; `pnpm dev:tunnel:ngrok` |
| PayMongo webhook points at that URL, **enabled**, same mode as the key | `GET /v1/webhooks` (Claude checks); events: `checkout_session.payment.paid`, `payment.paid`, `payment.failed`, `payment.refunded`, `payment.refund.updated` |
| `PAYMONGO_WEBHOOK_SECRET` matches that webhook | Claude checks |
| `PDF_RENDER_ORIGIN` = local server (`http://localhost:5175`) | `.env` |
| BIR settings: an **active OR series** + "auto-issue receipt on payment" on | Finance → BIR → Setup / Series |
| SMTP set, or a mail catcher running, to see the email + PDF | `npx maildev`, `SMTP_HOST=localhost SMTP_PORT=1025` |
| A cashier shift open (for desk payments) | Front desk → Open shift |
| Test data: one room type with a normal rate plan, one with a **50% downpayment** policy | Settings → Rates |

Test cards / e-wallet test pages: use PayMongo's current testing guide
(developers.paymongo.com → Testing). `4343 4343 4343 4345` is the standard successful
test Visa; take decline and 3-D Secure cards from the guide.

## Part 1 — Test mode

### A. Online booking and payment

| ID | Case | Steps | Pass when | Results |
|---|---|---|---|---|
| A1 | Card, pay in full | Book one room → pay with the success test card | Returns to confirmation; order + booking `confirmed`; one `payments` row (`paid`, `settlement`); cash movement in Undeposited Funds; OR issued; confirmation email sent **with `Official-Receipt-….pdf`** | |
| A2 | Card with 3-D Secure | As A1 with a 3DS test card, approve the challenge | Same as A1 | |
| A3 | GCash | Pay via GCash test page → Authorize | Same as A1 | |
| A4 | Maya | Pay via Maya test page → Authorize | Same as A1 | |
| A5 | QR Ph | Pay via QR Ph test flow | Same as A1 | |
| A6 | Downpayment 50% | Book the downpayment rate plan, pay the deposit only | `purpose = deposit`; guest sees "Due at the hotel"; front desk shows the balance owed | |
| A7 | Downpayment, guest pays in full | Same plan, choose pay-in-full | `settlement`, balance 0 | |
| A8 | Multi-room + function hall in one cart | 2 rooms + hall, one payment | One order, every line confirmed; payment split across rooms correctly on the Transaction page | |

### B. Failures and edge cases

| ID | Case | Steps | Pass when | Results |
|---|---|---|---|---|
| B1 | Declined card, then retry | Decline card, then success card on the same checkout | Failed attempt recorded (`failed`), order stays pending, retry confirms normally | |
| B2 | E-wallet "Fail" | GCash test page → Fail | Order stays `pending_payment`; nothing confirmed | |
| B3 | Guest abandons checkout | Close PayMongo page, don't pay | After `PENDING_ORDER_TTL_MINUTES` the order is `cancelled` and the room is bookable again | |
| B4 | Resume payment | Abandon, then use the "pay now" / payment-link email before the hold lapses | Pays and confirms on the original order | |
| B5 | Webhook redelivery | PayMongo dashboard → resend a `checkout_session.payment.paid` | No second `payments` row, no second email, no second OR | |
| B6 | Payment after hold expired | Let the hold lapse, then pay the stale checkout (if PayMongo still allows it) | Payment kept, order stays cancelled, history note "refund required" | |
| B7 | Webhook unreachable | Stop the tunnel, pay, restart tunnel, let PayMongo retry | Order confirms once the retry lands; no duplicates | |

### C. The stay (front desk)

Use the A1 booking unless noted.

| ID | Case | Steps | Pass when | Results |
|---|---|---|---|---|
| C1 | Check in | Front desk → assign room → check in | Room shows Occupied; folio balance 0 (prepaid) | |
| C2 | Early check-in fee | Check in before check-in time | Hours pre-filled from the clock; fee posts to folio | |
| C3 | Add a charge + take payment | Add an amenity/ad-hoc charge, pay cash at the desk | OR issued for the desk payment; cash movement in the drawer | |
| C4 | Late checkout fee | Check out after checkout time | Hours pre-filled; fee posts | |
| C5 | Check out | Check out with balance 0 | Booking `checked_out`; invoice issued; room flagged dirty for housekeeping | |
| C6 | Documents print | Print the invoice and both ORs (A4 and thermal) | Serials sequential, totals match the folio, BIR footer correct | |
| C7 | A6 balance at the desk | Collect the downpayment balance at check-in | Balance 0; OR references the invoice once issued | |

### D. Cancellations and refunds

| ID | Case | Steps | Pass when | Results |
|---|---|---|---|---|
| D1 | Cancel an **unpaid** booking | Staff cancel a `pending_payment` order | Cancelled; PayMongo checkout session expired | |
| D2 | Cancel paid booking, refund **cash** | Cancel an A1-type booking, refund method cash | Refund row + cash movement out; folio nets to the fee; cancellation email sent | |
| D3 | Cancel paid booking, refund **via PayMongo** (card) | Same, refund method PayMongo | **Either** refund created (`payments` refund row, `paymongoRefundId`), then `payment.refunded` / `payment.refund.updated` webhooks received and handled — **or** PayMongo refuses in test mode (e.g. balance) and the cancel stops with an error and nothing half-done. Record which. | |
| D4 | QR Ph refund | Refund a QR Ph payment via PayMongo | Refund row `pending` until the `payment.refund.updated` = `succeeded` webhook flips it to paid and posts the cash-out | |
| D5 | No-show | Mark a paid, not-arrived booking no-show | Folio equals what was paid; no refund due, nothing owed | |

If D3/D4 can't complete in test mode, they move to Part 2 as a small real refund.

### E. Reconciliation (after all cases)

| ID | Check | Pass when | Results |
|---|---|---|---|
| E1 | PayMongo dashboard vs app | Every test payment/refund in the dashboard exists once in **Finance → PayMongo**, same amount | |
| E2 | Finance totals | Cash-in for the day equals the sum of payments taken | |
| E3 | Day close + Z-reading | Close the test day | Z-reading issued; OR serial span matches the ORs issued | |
| E4 | Dashboard | Arrivals/departures/cash match what was done | |

## Part 2 — Live mode (after you switch)

**Switch-over checklist** (no live payment until all are done):
- Live secret key in the server's env; test key removed.
- A **new live-mode webhook** (PayMongo keeps test and live separate) with the same events, pointing at the **permanent** public URL — never a tunnel URL; its secret in `PAYMONGO_WEBHOOK_SECRET`.
- `ORIGIN` = the public URL; `PDF_RENDER_ORIGIN` = the server's internal address.
- Chromium installed on the server (`pnpm exec playwright install chromium`).
- Real BIR series and settings (not the sample series), real SMTP.

**Live smoke test** (real money, smallest amounts):

| ID | Case | Pass when | Results |
|---|---|---|---|
| L1 | Book a low-price test rate, pay by card | As A1, and the payment appears in the live dashboard | |
| L2 | Same with GCash (and Maya if enabled on the account) | As A1 | |
| L3 | Refund L1 via PayMongo | Refund lands on the card; webhook updates the row; Finance shows the cash-out | |
| L4 | Reconcile | Live dashboard ↔ Finance → PayMongo match; next payout recorded as a transfer out of Undeposited Funds | |
| L5 | Retire test data | Test bookings cancelled/refunded; nothing test-mode left looking like real revenue | |

## Known fixes from preparing this plan

- 2026-09-23: webhook handler listened for `payment.refund_updated`; PayMongo sends
  `payment.refund.updated`. Every refund status update was ignored. Fixed (both spellings
  accepted).
