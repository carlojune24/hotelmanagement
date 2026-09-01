# MM finance standard (draft — finalised in Phases 3 & 5)

Owning package: `@mm/finance-core`. Read the [shared rules](./README.md) first.

## Chart of accounts

| field | type | notes |
|---|---|---|
| `id` | uuid | app-local |
| `account_ref` | `acct_<ULID>` | cross-app identity |
| `org_ref` | `org_<ULID>` | |
| `code` | string | e.g. `1000`, natural key within org |
| `name` | string | |
| `type` | enum | `asset \| liability \| equity \| income \| expense` — fixed |
| `subtype` | string | PFRS/BIR-aligned bucket, e.g. `cash_on_hand`, `accounts_receivable`, `output_vat`, `salaries_expense` |
| `parent_ref` | `acct_<ULID>` \| null | roll-up tree |
| `is_postable` | boolean | leaf accounts only |
| `source_app`, `source_id` | | |
| `updated_at`, `deleted_at` | | |

A default hotel COA seed set ships in `@mm/finance-core`.

## Journal entry (double-entry, immutable)

| field | type | notes |
|---|---|---|
| `id` | uuid | |
| `org_ref` | | |
| `entry_no` | string | per-org sequence |
| `date` | `YYYY-MM-DD` | accounting date |
| `memo` | string | |
| `source_type` | string | `booking_payment \| deposit \| refund \| amenity_sale \| expense \| payroll_run \| cash_movement \| manual` |
| `source_ref` | string | the source document's id |
| `lines[]` | array | ≥ 2; sum of debits = sum of credits, exactly |
| `posted_at` | instant | |
| `source_app`, `source_id` | | |

Journal line:

| field | type | notes |
|---|---|---|
| `account_ref` | `acct_<ULID>` | postable leaf |
| `debit_minor` | `amount_minor` | ≥ 0 |
| `credit_minor` | `amount_minor` | ≥ 0; exactly one of debit/credit is non-zero |
| `currency` | currency | |
| `dimensions` | object | `{ org_ref, hotel_id, department?, cost_center?, project? }` — how consumers group and eliminate |

## Cash movement (canonical)

Mirrors a journal entry one-to-one; it is the cash-basis view used for cashflow
and day-close.

| field | type | notes |
|---|---|---|
| `id` | uuid | |
| `org_ref` | | |
| `direction` | enum | `in \| out` |
| `category` | enum | `room_revenue \| reservation_fee \| deposit \| deposit_refund \| amenity_sale \| other_revenue \| expense \| payroll \| statutory_remittance \| cash_advance \| cash_advance_repayment \| transfer \| adjustment` |
| `account_ref` | `acct_<ULID>` | the cash/bank/e-wallet account moved |
| `counterparty_ref` | `cpty_<ULID>` \| null | guest, vendor, employee, agency |
| `amount` | `{ amount_minor, currency }` | always positive; `direction` carries the sign |
| `occurred_at` | instant | |
| `source_type`, `source_ref` | string | link back to the originating document |
| `journal_entry_ref` | uuid \| null | the mirrored entry |
| `dimensions` | object | same shape as journal-line dimensions |
| `source_app`, `source_id` | | |
| `updated_at`, `deleted_at` | | |

## Posting rules

`@mm/finance-core` exposes a `PostingRule` interface: `(event) => JournalEntryDraft`.
The hotel app registers rules for each `source_type`; posting is triggered inside
the same transaction as the operational write and also emits the
`journal_entry.posted` / `cash_movement.recorded` outbox events.

## Reports

Report builders take `{ hotel_ids: string[], date_from, date_to, dimensions? }` so
a single property, a group, or an external consolidator all call the same code:

- **ledger** — per account, opening balance + movements + running balance, drill to source.
- **trial-balance** — debits/credits per account for the range; must balance.
- **income-statement** — revenue less expense by `subtype`, per hotel column + total.
- (balance-sheet, VAT summary, withholding summary follow the same signature.)
