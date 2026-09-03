# MM HR standard (draft — finalised in Phase 4)

Owning package: `@mm/hr-core`. Read the [shared rules](./README.md) first.

## Entities

### Org

The legal/employing entity. In the hotel app, org identity is **not a separate
table** — it is carried directly on the entity that legally employs staff:

- **Grouped hotel** (`hotels.group_id` is set): the org is the owning
  `hotel_groups` row. All hotels in that group share one `org_ref` — one
  legal employer across properties (e.g. a single SEC-registered company
  operating several properties). `hotel_groups` carries the org fields below
  in addition to its portfolio fields (`slug`, `name`, `owner_user_id`).
- **Standalone hotel** (`hotels.group_id` is null): the org is that hotel's
  own row — `hotels.org_ref` (already present since Phase 0), unchanged.

`employees.org_ref` is resolved at write time to whichever of the two applies
for the employee's org — never both, never a third source. This mirrors the
`org_ref` field elsewhere in this doc as a *cross-app identity* (no local FK;
see `hotels.orgRef`, which already has no DB-level reference for the same
reason).

`timezone` below is the **portable-standard default only**. The operative
wall-clock for a specific shift/DTR entry is always that shift's own
`hotels.timezone` (via `schedules.hotel_id`), because two properties in the
same group can in principle sit in different timezones even though today all
target hotels are `Asia/Manila`.

| field | type | notes |
|---|---|---|
| `id` | uuid | app-local |
| `org_ref` | `org_<ULID>` | cross-app identity |
| `legal_name` | string | as registered |
| `trade_name` | string \| null | |
| `tin` | string | `NNN-NNN-NNN-NNNNN`, natural key |
| `timezone` | IANA tz | wall-clock basis for schedules/DTR |
| `default_currency` | currency | `PHP` |
| `source_app`, `source_id` | | |
| `updated_at`, `deleted_at` | instant / nullable | |

### Employee master

Fixed field set below **plus** `extensions` (jsonb) for app-specific data. A
consumer that does not understand an extension key ignores it.

| field | type | notes |
|---|---|---|
| `id` | uuid | app-local |
| `person_ref` | `per_<ULID>` | **the** cross-app person key |
| `org_ref` | `org_<ULID>` | employer |
| `employee_no` | string | org-assigned, natural key within org |
| `first_name`, `last_name` | string | |
| `middle_name`, `suffix` | string \| null | |
| `birthdate` | `YYYY-MM-DD` | |
| `sex` | enum `male \| female` | statutory forms need it |
| `hired_on` | `YYYY-MM-DD` | |
| `employment_type` | enum | `regular \| probationary \| project \| seasonal \| fixed_term \| casual \| part_time` |
| `status` | enum | `active \| on_leave \| suspended \| separated` |
| `separated_on` | `YYYY-MM-DD` \| null | |
| `position` | string | |
| `department` | string \| null | |
| `cost_center` | string \| null | ties payroll cost to a GL dimension |
| `primary_hotel_id` | uuid \| null | **app-local, hotel-app specific.** Nullable FK to this app's `hotels` table — the employee's home-base property. Not part of the payload for non-hotel consumers of `@mm/hr-core`; omit/ignore outside this app. Per-shift property is carried on `schedules`/`dtr_entries`, not here. |
| `pay_basis` | enum | `monthly \| daily \| hourly` |
| `base_rate` | `amount_minor` | per the `pay_basis` unit |
| `gov_ids` | object | `{ sss, philhealth, pagibig, tin }` — strings, natural keys |
| `disbursement` | object | `{ method: 'cash' \| 'bank' \| 'ewallet', bank_code?, account_name?, account_no? }` |
| `biometric_enroll_id` | string \| null | matches punch rows on import; app-local concern but stored here |
| `extensions` | jsonb | app-specific |
| `source_app`, `source_id` | | |
| `updated_at`, `deleted_at` | | |

### Schedule (app-owned shape, referenced by DTR)

Per employee per calendar date: a shift (`start`, `end`, `break_minutes`,
`night_diff_window`) or a rest day, plus **`hotel_id`** (required, not
nullable — the specific property this shift is worked at). One employee can
have schedule rows at different `hotel_id`s within the same cutoff as long as
every `hotel_id` resolves to the same org as the employee's `org_ref`
(same group, or the same standalone hotel). `dtr_entries` derived from a
schedule row carry the same `hotel_id`, denormalized, so payroll-cost-by-
property reporting doesn't require a join back through `schedules`. Holidays
carried on an org calendar (`regular` / `special_non_working`). Consumers
usually need only the payroll-run result, not raw schedules, but the endpoint
exists for audit.

### Payroll-run result

Immutable once posted. One run covers one cutoff for one org. For a grouped
hotel, "one org" means **all hotels in the group** — a run is group-wide, not
per-property. The per-property split (payroll cost by property) is a
**derived report**, computed by the app by joining `schedules`/`dtr_entries`
`hotel_id` against this run's lines; it is intentionally not a field on the
line shape below, so this standard stays portable to non-hotel consumers.

| field | type | notes |
|---|---|---|
| `id` | uuid | |
| `org_ref` | | |
| `cutoff_start`, `cutoff_end` | `YYYY-MM-DD` | |
| `pay_date` | `YYYY-MM-DD` | |
| `status` | enum `draft \| locked \| posted` | |
| `lines[]` | array | one per employee, see below |
| `posted_at` | instant \| null | |

Payroll-run line:

| field | type |
|---|---|
| `person_ref` | `per_<ULID>` |
| `cost_center` | string \| null |
| `days_worked`, `hours_regular`, `hours_ot`, `hours_night_diff` | number |
| `earnings` | `{ basic, overtime, holiday_premium, night_diff, allowances, other }` — each `amount_minor` |
| `gross` | `amount_minor` |
| `deductions` | `{ sss_ee, philhealth_ee, pagibig_ee, withholding_tax, cash_advance, loans, tardiness_undertime, other }` |
| `employer_contributions` | `{ sss_er, philhealth_er, pagibig_er, ecc }` — for remittance/GL, not netted from pay |
| `net_pay` | `amount_minor` |
| `thirteenth_month_accrual` | `amount_minor` |

## Statutory tables

Live in `@mm/hr-core/statutory`, one module per program per effectivity, each
exporting an `effective_date` and a pure function. Values are **configuration**,
verified against the latest SSS circular / PhilHealth advisory / Pag-IBIG circular
/ BIR RMC before go-live:

- **SSS** — 2026: 15% of MSC (MSC ₱5,000–₱35,000), employee share 5%, plus EC.
- **PhilHealth** — 5% premium, floor ₱500 / ceiling ₱5,000 monthly, split 50/50.
- **Pag-IBIG** — 2% employee, compensation cap ₱10,000 (max ₱200), employer matches.
- **BIR** — TRAIN withholding brackets (daily/weekly/semi-monthly/monthly); first
  bracket 0%, then 15%–35%. Annualised true-up at year-end.

## Events

`employee.updated` — `data` is the full employee-master shape.
`payroll_run.posted` — `data` is the full payroll-run result.
