# Manual test plan — dining's own cash drawer

Everything on branch `feat/dining-cash-drawer`. Work top to bottom: later sections assume the
earlier setup. Times shown anywhere in the app should read **12-hour** (2:00 PM, not 14:00).

**Accounts needed:** an admin (`hotel_admin`), the **Dining** account, and ideally a front-desk
account. Dining must be signed out and back in once — the role gained a capability.

**Money check used throughout:** ₱ amounts are integer centavos server-side; a sale of ₱199.00
must show as `19900` in `cash_movements.amount_centavos`.

---

## 0. Before you start — migration

| # | Step | Expect |
|---|---|---|
| 0.1 | `pnpm --filter @mm/hotel db:migrate` | `0105_curved_psylocke.sql` applies; `finance_settings.dining_drawer_account_id` exists |
| 0.2 | `pnpm --filter @mm/hotel check` | 0 errors |
| 0.3 | `pnpm --filter @mm/hotel test` | 12 failures in 6 files — **pre-existing**, they fail on `main` too. Anything beyond that is new |

> The dev DB has already been migrated and configured. On a fresh DB, do sections 1–3 first.

---

## 1. Cash accounts — chart-of-accounts link (the blocker that was fixed)

Finance → Settings → **Cash accounts**.

| # | Step | Expect |
|---|---|---|
| 1.1 | Add account: name `Pool Bar Drawer`, kind `cash drawer`, no opening balance | "Account added." |
| 1.2 | Finance → **Accounts**, search `Pool Bar Drawer` | A chart-of-accounts leaf exists with that name, code `1013` (next free in the drawer decade 1010‑1019) |
| 1.3 | Add another account with the **same name** | Refused: *A cash account called "Pool Bar Drawer" already exists.* |
| 1.4 | Finance → Settings cash list | Any name held by two accounts shows a **duplicate name** badge (the two `Dining Desk Drawer` rows do) |
| 1.5 | Rename `Pool Bar Drawer` → `Pool Drawer`, re-check Finance → Accounts | The COA leaf renamed too; code stays `1013` |
| 1.6 | SQL: `select name, coa_account_id from cash_accounts` | **No** active account has a null `coa_account_id` |

**Regression guard:** a cash account made in the UI used to post nothing — "This cash account has
no chart-of-accounts link yet." If you ever see that message again, 1.2 is broken.

Tidy up: deactivate or delete `Pool Drawer` before section 4 so it doesn't clutter the pickers.

## 2. The two tills — configuration guards

Finance → Settings → **Preferences**.

| # | Step | Expect |
|---|---|---|
| 2.1 | Read the two drawer pickers | **Front desk drawer** = `Front Desk Drawer`; **Dining drawer** = `Dining Desk Drawer` |
| 2.2 | Open the **Front desk drawer** list | `Dining Desk Drawer` is **not** offered |
| 2.3 | Open the **Dining drawer** list | `Front Desk Drawer` is **not** offered; `— none —` is available |
| 2.4 | Change Dining drawer to `— none —`, save, reopen | Saved; dining now falls back to the front desk till (undo this after 2.5) |
| 2.5 | Force the clash: POST `?/updateSettings` with the same uuid in both fields (devtools / curl) | Refused: *The dining drawer must be a different till from the front desk drawer.* Settings unchanged |
| 2.6 | Restore Dining drawer = `Dining Desk Drawer`, save | Saved |

## 3. Roles

Settings → Team → **Roles**.

| # | Step | Expect |
|---|---|---|
| 3.1 | Dining role → Edit → **DINING** section | Four entries, the new one being **"Open and close the dining drawer"** |
| 3.2 | With "Everything in Dining" ticked | The four singles show ticked **and** locked ("Already granted by a broader permission above") |
| 3.3 | **Folio & Payments** section | `payment:create` reads **"Walk-in quick sale (front desk register)"**; `dining:write` reads "…orders, reservations and payments (the dining register)" |
| 3.4 | Save the Dining role touching only its description, reopen | `dining:*` still ticked — the wildcard round trip (covered by `e2e/roles-wildcards.spec.ts`) |
| 3.5 | Untick "Everything in Dining", tick only read/write/manage, save | Dining loses the drawer; see 5.6 |
| 3.6 | Re-tick "Everything in Dining", save | Restored |

## 4. Front desk — no drawer picker

Sign in to the front desk. `/{slug}/management/front-desk`.

| # | Step | Expect |
|---|---|---|
| 4.1 | Look at the header toolbar | Reads `Front Desk Drawer` as **plain text** + `Float ₱` + **Open shift**. **No dropdown**, even though several drawers exist |
| 4.2 | Open a shift with float `1000` | Green chip: `Shift open · float ₱1,000.00` |
| 4.3 | POST `?/openShift` with a `cashAccountId` field naming the dining drawer | Ignored — the shift opens (or errors) on the **front desk** drawer only |
| 4.4 | Take a cash room payment | Lands in the front desk shift |

## 5. Dining — opening and closing its own till

Sign in as **Dining** (sign out first if you were already in). `/{slug}/management/dining/orders`.

| # | Step | Expect |
|---|---|---|
| 5.1 | Orders toolbar | `Float ₱` + **Open shift**, beside Search / New order |
| 5.2 | Open with float `1.00` | Green chip `Dining Desk Drawer open · float ₱1.00`; the chip is a **link** |
| 5.3 | Dining tab bar | A **Drawer** tab now appears, after Cashflow |
| 5.4 | Click the green chip | Lands on Dining → Drawer, showing the open-shift card |
| 5.5 | Try `/{slug}/management/finance/shifts` directly | **403** — dining has no `finance:read`. This is correct; the Drawer tab is its route in |
| 5.6 | With 3.5 applied (no drawer capability), reload Orders | The Float/Open shift control is gone; POST `?/openDrawer` → *Missing capability: dining:shift or shift:write* |

## 6. Dining → Drawer page

| # | Step | Expect |
|---|---|---|
| 6.1 | The card header | Drawer name + **Open** badge + "Opened <12-hour time> by Dining" |
| 6.2 | The four figures | Opening float / Cash in / Cash out / **Expected in drawer** |
| 6.3 | Shift history table | **Only this drawer's** shifts. The front desk's shift from 4.2 must **not** appear |
| 6.4 | Drawer event → **Payout** ₱50, reason "ice run", category Uncategorised, Add | "Recorded." Cash out rises ₱50; Expected drops ₱50 |
| 6.5 | Drawer event → **Cash drop → bank** ₱100 | Recorded; drawer down, no expense created |
| 6.6 | Type a counted amount in **Close shift** | Live **Balanced / Over ₱x / Short ₱x** under the field |
| 6.7 | POST `?/closeShift` with the **front desk's** open shift id | Refused: *That is not the dining drawer's open shift.* |

## 7. Dining money actually lands in dining's till

Keep both shifts open (front desk from 4.2, dining from 5.2).

| # | Step | Expect |
|---|---|---|
| 7.1 | Dining → Orders → **New order** → **Takeaway** → a dish → **Place & pay**, cash | Paid; receipt/doc issues as before |
| 7.2 | Dining → Drawer | **Cash in** rose by the order total; Expected followed |
| 7.3 | Front desk header | Its shift total is **unchanged** by that sale |
| 7.4 | SQL on the new `cash_movements` row | `direction = in`, `category = dining_revenue`, `cash_account_id` = Dining Desk Drawer, `shift_id` = dining's shift |
| 7.5 | The journal entry for it | Cash leg posts to COA **`1012` "Dining Desk Drawer"**, not `1010` |
| 7.6 | Refund that order (Dining → Orders, needs `dining:manage`) | The reversal comes **out of the dining drawer**, not the front desk's |
| 7.7 | Pay a dining order with **GCash / card** instead | No shift id; lands in the bank / e-wallet account — department split is **cash only**, by design |
| 7.8 | Charge a dining order **to a room**, then settle at the front desk | Settles into the **front desk** drawer (the guest pays the desk) — correct, not a bug |

## 8. Close out, and the finance end of the trail

| # | Step | Expect |
|---|---|---|
| 8.1 | Dining → Drawer → Close shift, counted = expected | *Dining drawer closed — balanced.* |
| 8.2 | Repeat with a deliberate short count on a new shift | *…short ₱x*; an `adjustment` movement posts so the drawer balance matches the count |
| 8.3 | Admin → Finance → **Shifts** | Both shifts listed, each on its own drawer, with their own expected/counted/variance. The card looks **exactly as before** (it is now a shared component) |
| 8.4 | Finance → Shifts → a dining shift → Details | Full reconciliation, movements and events |
| 8.5 | Finance → **Cash** / Accounts | Dining Desk Drawer carries its own running balance, separate from Front Desk Drawer |
| 8.6 | Finance → **Reports** → Quick sales / daily sales for today | Dining's takings appear, attributed to the dining shift |
| 8.7 | Dining → **Cashflow** and **Sales** | Dining money reads consistently with 7.4 |
| 8.8 | Finance → **BIR** → Readings, with a shift still open | Refuses: counts **both** open shifts. Close both, then it proceeds |
| 8.9 | Finance → **Day close** with both shifts closed | Closes normally |

> 8.8 is the main operational change: **dining must close its drawer nightly**, or the front desk
> cannot close the day.

## 9. Times are 12-hour

Spot-check the earlier display fix:

| # | Where | Expect |
|---|---|---|
| 9.1 | Front desk → a reserved room → arrival panel | "from 2:00 PM", "Wants to move in before 2:00 PM", "by 12:00 PM" |
| 9.2 | Front desk → function hall rows, availability calendar | Event times as `2:00 PM–6:00 PM` |
| 9.3 | Guest confirmation / manage / review pages with a hall booking | Same 12-hour format |
| 9.4 | Settings → Check-in/out | Still the raw `HH:MM` **time inputs** — these must stay 24-hour |

---

## Automated

```bash
pnpm --filter @mm/hotel exec playwright test e2e/dining-drawer.spec.ts
pnpm --filter @mm/hotel exec playwright test e2e/roles-wildcards.spec.ts
```

`dining-drawer.spec.ts` covers: a new drawer gets its own COA leaf, the two pickers exclude each
other, the unconfigured state, the open/close round trip, and dining's shift not displacing the
front desk's. **Untested as written** — its `ensureDiningDrawer` helper guesses the Add-account
button labels; if it fails on the first run, that selector is the likely cause.

## Known gaps

- Non-cash dining payments (card / GCash / Maya) always go to the bank account — no per-department
  split for them.
- The deactivated duplicate `Dining Desk Drawer` still points at COA `1010`. It cannot post (a
  shift can't open on an inactive account); it needs its own leaf before being reactivated.
- Two front-desk counters with separate drawers is no longer expressible — the picker that allowed
  it by accident is gone. A second counter needs its own register surface, as dining has.
- The Dining → Drawer page reuses the approved Finance shift card, but the page itself has not had
  the `impeccable` design pass CLAUDE.md asks for.
