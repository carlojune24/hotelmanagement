# Dining's own cash drawer

How the restaurant's till works, where its money goes, and what to check when a count looks wrong.
The step-by-step test plan and the 2026-10-25 regression run live in
[`TEST-dining-drawer.md`](./TEST-dining-drawer.md); this is the reference.

## Why dining has a till of its own

Dining is a register in its own right, not a corner of the front desk. A waiter takes cash at the
restaurant, a cashier counts that cash at the end of the night, and the variance is theirs — not
the receptionist's. Before this, dining cash fell into whatever shift the front desk had open, so
two people were accountable for one drawer and neither could prove their count.

So: **one register, one drawer, one shift, one count.** The front desk counts its own.

## Setting it up

A seeded hotel already has it: `db:seed` creates a **Dining Desk Drawer** beside the front desk's,
gives it its own chart-of-accounts leaf, and points Finance → Settings at it — along with a demo
venue, tables and a short menu, so a dining account can take an order and a payment on a fresh
database. An older hotel sets it up by hand:

Finance → Settings → **Preferences** holds two pickers:

| Setting | Meaning |
|---|---|
| **Front desk drawer** | The hotel's default till. Every register without one of its own rings into it. |
| **Dining drawer** | Dining's till. Leave it empty and dining cash keeps going to the front desk drawer, exactly as before. |

Each picker hides the other's choice, so one drawer can never serve both registers — the clash
that silently merges dining's cash into the desk's. The server refuses it too, not just the UI.

A cash account added in Finance → Settings gets its **own chart-of-accounts leaf**, named after it,
in the cash-on-hand decade (`1010`–`1019`, shared with petty cash). That is what lets the balance
sheet show the two tills apart: the front desk posts to `1010`, dining to `1012`. An account with
no leaf cannot post at all.

## Who may open and close it

`dining:shift` — "Open and close the dining drawer" — is on the Dining role by default. The
hotel-wide `shift:write` that finance and the front desk hold also grants it, so a manager can
always run any drawer. A dining account does **not** get `finance:read`, so Finance → Shifts is a
403 for them; the **Drawer** tab is their way in.

## Where the staff do it

- **Dining → Orders** — the toolbar opens the shift (float + **Open shift**) and shows a green
  chip, `Dining Desk Drawer open · float ₱1,000.00`, linking to the Drawer page.
- **Dining → Quick sale** — the off-menu till: corkage, a bottle of water, anything with no dish
  behind it. Same cart as the front desk's Quick sale, but the cash goes into dining's drawer and
  posts as dining revenue. A dish goes through Orders instead, so the kitchen sees it.
  Picking **Room** puts the cart on a staying guest's bill instead: nothing is taken at the till,
  no shift is involved, and the front desk collects it at check-out. Recording it as a sale *and*
  letting the guest pay it later would count the same money twice — so it posts one `folio_charges`
  line per item (`source: 'dining'`) and no cash movement at all. When the folio is settled, the
  dining share comes back to `dining_revenue` automatically.
- **Dining → Drawer** — the whole till: the open-shift card (opening float, cash in, cash out,
  expected in drawer), payouts and cash drops, closing the count, and the shift history for **this
  drawer only**. Closing lives here and nowhere else; the Orders toolbar only opens.
- **Finance → Shifts** — a manager's view of every shift, each on its own drawer.

## Quick sale: off-menu, and "charge to room"

Orders is for dishes — the kitchen needs to see those. Quick sale is for everything else: corkage,
a bottle of water, a charge with no dish behind it. The cart is the front desk's, with two
differences.

**Paid at the till.** Cash, card, GCash, Maya or bank transfer. It rings into dining's drawer and
posts as `dining_revenue`, so it shows in Dining → Sales and Cashflow rather than disappearing into
the hotel's incidentals. A typed custom item is saved to the catalog, so the second time it is one tap.

**Charged to a room.** Pick **Room**, then the guest — by room number, name or booking code, from
the guests staying right now. Nothing is taken at the till:

- one `folio_charges` line **per item**, `source: 'dining'`, so the bill reads like a bill;
- **no cash movement, no shift, no OR.** The receipt belongs to the payment, and the payment
  happens at check-out. Ringing it as a sale *and* letting the guest pay later would count the
  same money twice;
- the front desk collects it at check-out, into **the desk's** drawer, and the dining share comes
  back to `dining_revenue` when the folio is settled;
- a closed bill is refused — "This guest's bill is closed. Charge it another way." Undo a line
  from the folio while it is still open.

Till prices include VAT, so the base and the VAT are split **per unit**: they multiply back to
exactly the price quoted, with no rounding drift on a quantity.

## The money trail

A cash sale at the restaurant leaves one trail, and every hop is queryable:

```
dining_orders        DN-XXXX  cash   cash_account_id → Dining Desk Drawer
                                     shift_id        → dining's open shift
cash_movements       in / dining_revenue / <total>
                     source_type 'dining_order' → the order,  memo "Dining DN-XXXX"
journal_lines        1012 Dining Desk Drawer        debit  <total>
                     4040 Food & Beverage Revenue   credit <total>
```

`recordCashMovement` (`lib/server/finance/cash.ts`) is the single choke point — it writes the
movement, moves the account balance and posts the journal entry in one transaction, so money
without a ledger entry is not possible on this path.

What goes where:

| Event | Lands in | Carries a shift? |
|---|---|---|
| Cash order, or a table check settled in cash | Dining's drawer | Yes, dining's |
| Card / GCash / Maya | The default bank or e-wallet account | No — only cash drawers have shifts |
| Online (PayMongo) | Undeposited Funds until PayMongo pays out | No |
| Charged to a room | No cash movement — a folio charge; it settles at the front desk when the guest pays, into **the desk's** drawer | At the desk |
| Cash refund | Out of the till that **took** the money | Yes, if that drawer has one open |
| Quick sale (off-menu) | Dining's drawer | Yes, if cash |
| Quick sale charged to a room | No cash movement — a folio charge; the desk collects it at check-out | At the desk |
| Payout, cash drop, close variance | Dining's drawer | Yes |

The last two rows matter: a refund follows the original payment's drawer, not whichever drawer
dining points at today, and a room charge is the guest paying the desk — that is correct, not a
leak.

## The opening float

The float is real cash, so it is real in the ledger. Opening a shift **tops the drawer up to its
declared float** from the default bank account, as a paired transfer — the same move a
"Float pickup ← bank" drawer event makes.

Three rules keep it honest:

- **Only the shortfall moves.** A till whose cash stayed in it overnight already covers tomorrow's
  float, so nothing posts the next morning.
- **Never more than the float.** A wrong or negative book balance is a correction, not a float, and
  must not drag a fortune out of the bank to catch up.
- **The float movements carry no `shift_id`.** The shift's expected cash already counts the float
  once, through the shift's own opening figure; tagging them would make every drawer expect its
  float twice and post a bogus shortfall at close. `source_type='shift_open'` keeps the audit link.

Opening a shift never fails because of this. If there is no bank account, the business day is
closed, or an account has no chart-of-accounts link, the shift opens anyway and the cashier is told
why the float did not post.

Expected cash at close is always `opening float + cash in − cash out`, counting only movements on
that drawer, in that shift. Count short and an `adjustment` posts so the drawer's balance matches
what was actually counted.

## Closing out

**Dining must close its drawer nightly.** The day close refuses while *any* cashier shift is still
open, and the Z reading needs the day closed — so a dining shift left open blocks the front desk
from closing the day and from its Z. The BIR → Readings page counts the open shifts for the date so
you can see what is holding it. That is the one operational change this feature brings.

## When a count looks wrong

1. **Is the right drawer configured?** Finance → Settings → Dining drawer.
2. **Whose shift was open?** A sale is tagged with the shift that was open *on that drawer* when it
   was paid. Nothing else can claim it.
3. **Does the drawer's ledger balance look impossible?** A negative cash account means money left
   the ledger that never physically left the till — usually floats or deposits that were never
   recorded. Finance → Cash shows each account's running balance.
4. **Online money is not in the drawer.** It sits in Undeposited Funds until PayMongo pays out; it
   will never appear in a shift count.
5. **A dining shift shows no payment breakdown** in Finance → Shifts. Dining orders do not write
   `payments` rows, so that panel is empty by design — the movements list is the real record.

## Testing it

```bash
pnpm dev                                           # terminal 1, http://localhost:5175
cd apps/hotel
E2E_HOTEL_SLUG=mmhotel pnpm exec playwright test e2e/dining-drawer.spec.ts
```

The dev hotel's slug is `mmhotel`; `e2e/helpers.ts` defaults to `hotel1`, so pass it or every test
skips itself. The spec rings up a real cash sale through the UI and then reads the rows it left
behind (`e2e/db.ts` is a read-only connection for exactly that) — the drawer, the shift, the
category, the amount, the source and both journal legs. It writes into the dev database and cleans
up its own shifts.

## Known gaps

- No per-department split for **non-cash** dining payments: card, GCash and Maya all go to the one
  bank account.
- A second front-desk counter with its own drawer is not expressible — it would need its own
  register surface, as dining has.
- The Drawer page reuses the approved Finance shift card but has not had its own `impeccable`
  design pass.
- Quick sale's own list of recent sales is shift- and cash-based, so a sale **charged to a room**
  does not appear on that page. It is on the guest's folio; the cashier has no confirmation list
  of what they put on which room.

---

*Written by **Jade**, 2026-10-26. Updated the same day with the seeded dining drawer, the Quick
sale till and charging a quick sale to a room.*
