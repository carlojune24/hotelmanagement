# MM domain standards

These documents are the **source of truth** for the data contracts that every MM
application implements so that people and money data consolidate without per-app
mapping.

- [`hr.md`](./hr.md) — org, employee master, schedule, payroll-run result.
- [`finance.md`](./finance.md) — chart of accounts, double-entry journal, cash movement.

## Rules that apply to both

1. **Identifiers**
   - `id` — app-local UUID v4, unique within the producing app only.
   - Cross-app references are opaque `<prefix>_<ULID>` strings, minted once, never
     re-pointed: `per_` (person), `org_` (legal entity), `acct_` (GL account),
     `cpty_` (counterparty). A consumer keys its own records off these.
   - Natural keys (government IDs, account codes) are carried but are **not** the
     join key — they change and collide.
2. **Source tracking** — every record a consumer ingests carries `source_app` +
   `source_id`. Ingestion is an idempotent upsert on `(source_app, source_id)`.
3. **Money** — integer minor units (`amount_minor`) + `currency` (ISO 4217, `PHP`
   only today). Never floats of major units.
4. **Time** — `instant` fields are ISO-8601 UTC with offset; wall-clock behaviour
   comes from an explicit IANA `timezone` on the org. Calendar-only values use
   `YYYY-MM-DD`.
5. **Enums are closed and versioned.** Adding a member is a minor bump; removing or
   renaming one is a major bump.
6. **Incremental sync** — every consolidatable entity exposes `updated_at` and a
   nullable `deleted_at` (soft delete). Read endpoints accept `updated_since`.
7. **Versioning** — `MM_STANDARD_VERSION` (currently `1.0.0`) is sent on every API
   response and event as `standard_version` and in the `x-mm-standard-version`
   header. Additive-only within a major.

## Integration surface

Read (cursor-paginated, `updated_since` filter, stable ids):

- `GET /api/v1/hr/orgs | employees | schedules | payroll-runs`
- `GET /api/v1/finance/accounts | journal-entries | cash-movements`
- `GET /api/v1/finance/reports/ledger | trial-balance | income-statement`
  (accepts one hotel, a group of hotels, or all)

Events (outbox table written in the state-change transaction, delivered
at-least-once, deduped on `id` by the consumer):

- `employee.updated`, `payroll_run.posted`, `journal_entry.posted`,
  `cash_movement.recorded`

The typed primitives live in `@mm/integration/primitives`; the event envelope in
`@mm/integration/events`.
