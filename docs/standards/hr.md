# MM HR standard (draft — finalised in Phase 4)

Owning package: `@mm/hr-core`. Read the [shared rules](./README.md) first.

## Entities

### Org

The legal/employing entity. In the hotel app one org maps to one hotel company
(a hotel group with a single SEC registration may share an org across properties).

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
`night_diff_window`) or a rest day. Holidays carried on an org calendar
(`regular` / `special_non_working`). Consumers usually need only the payroll-run
result, not raw schedules, but the endpoint exists for audit.

### Payroll-run result

Immutable once posted. One run covers one cutoff for one org.

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
