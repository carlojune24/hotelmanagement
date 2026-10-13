# HR_PLAN.md — Main HR as a separate app (`apps/hr`)

> Final plan, 2026-10-13. Planning only — no code. Supersedes the "hotel-scoped HR only" scope in
> `docs/TODO.md` Phase 4 and every earlier draft of this document.
> Pre-split code backup: branch `backup/pre-hr-split-2026-10-13`, tag `pre-hr-split-2026-10-13`.

## 1. Decision summary

The client now wants one company-wide HR that approves schedules, leave, OT and memos,
registers employees across the company, assigns them to businesses, generates payroll and payslips,
and receives each business's DTR. Each business manager manages their own staff from that same HR.

Decided:

1. **HR is a separate app**, `apps/hr`, in this pnpm workspace (`apps/*` already globbed). Not under
   the hotel app.
2. **Separate database** for HR. The hotel app has **no** HR tables, routes, or code.
3. **Separate domain** for HR (e.g. `hr.<client>.com`), same server as the hotel platform.
4. Hotel and HR talk **only through an API** (server-to-server, API keys) plus events.
5. **HR is removed from the hotel app.** Business managers (hotel or not) do all HR work in the HR app.
6. Non-hotel businesses exist **only in HR** (HR-only: no POS, Finance, Dining). The hotel app never
   needs to know about them.
7. The hotel's **Team invite stays in the hotel** and links to an HR employee by `person_ref`.

Why this is safe now: HR-per-hotel is not complete, so removing it costs little; the audit found
HR already well bounded (§11).

## 2. Architecture

```
apps/hotel  (hotel DB)                       apps/hr  (HR DB)            hr.<client>.com
  users, sessions, memberships, invites        users, sessions, memberships
  bookings, folio, finance, dining …           organizations, establishments
        │                                       employees, assignments
        │  person_ref  ◄─────── API ─────────► approvals, schedules, DTR, leave, OT
        │  (nullable on memberships/invites)    payroll, payslips, calendar
packages/hr-core (shared Zod types, person_ref/org_ref, statutory — already exists)
packages/integration (shared API/event contracts — already exists)
```

- **HR is the authority for people** (employment, assignment, status, pay, approvals).
- **Hotel is the authority for logins** (who can sign in, which role they hold).
- HR can't grant hotel access; the hotel can't create employees.
- Two deployments on one server, two databases, independent releases. Hotel work never depends on
  HR being up (§5).

## 3. Who does what

| Function | Main HR (company) | Business manager / clerk (per business, in HR app) |
|---|---|---|
| Register employees, pay, gov IDs, employment | ✅ only | ❌ view assigned staff |
| Assign employee to business(es) | ✅ only | ❌ |
| Roster | **Approves** | Builds + **submits** per week |
| Leave | **Approves**, owns policy and balances | **Files** for staff |
| Overtime | **Approves** | **Files** |
| Memo / holiday calendar | **Approves**; issues company-wide memos | **Proposes** business memo |
| Biometric upload → DTR | Receives; may return for correction | Uploads raw, generates, **submits** DTR |
| Payroll run | ✅ generates, locks, posts | ❌ |
| Payslips | ✅ generates + **releases** | **Downloads** for assigned staff, once released |
| Hotel Team accounts | — | In the hotel app (§4) |

## 4. Identity and Team invite (the key integration)

**Where the invite lives: hotel DB.** `users`, `memberships`, `invites` and roles stay in the hotel
app. HR stores no hotel logins.

The only link is `person_ref` (`per_<ULID>`, already minted per employee):
- hotel `memberships.person_ref` and `invites.person_ref` — new nullable columns.
- Team → **Add staff**: picker lists employees **assigned to this hotel** (HR API) → pick role → invite.
  Name, position, email are prefilled; the accepted account carries the `person_ref`.
- **Hotel works without HR.** If HR is unreachable the picker shows an error, existing staff keep
  working, and (per policy §12) invite-by-email without a link remains available.
- **Offboarding follows HR.** `employee.updated` (separated, or assignment ended) → hotel suspends or
  removes that membership. Hotel also pulls `updated_since` on a schedule as a fallback.
- **This is the only place the hotel touches HR:** Settings → Team → Add staff. No other hotel
  screen reads HR data, and the Team list does not fetch employee names (it shows the account as
  today; a linked account just carries its `person_ref`).
- A manager has **two logins** — hotel and HR (same email, separate accounts). No SSO in v1.

## 5. HR ↔ hotel API

Server-to-server, contracts in `@mm/integration` (`GET /api/v1/hr/…`, cursor + `updated_since`,
events). Keys: the HR app issues a per-hotel key (copy the hotel app's pattern — SHA-256 hash,
visible prefix, scopes, revoke/expiry — **not** its table: the hotel's `api_keys` is inbound,
single-hotel, `finance:read` only). The hotel stores its outbound HR key encrypted per hotel
(same approach as its PayMongo keys). Events HR → hotel are signed; the hotel verifies and exposes
one small inbound endpoint.

| Direction | Call | Purpose |
|---|---|---|
| Hotel → HR | `GET employees?assigned_to=<hotel org_ref>` | Team picker (the only UI use) |
| HR → Hotel | event `employee.updated` | Suspend/unlink membership on separation/transfer |
| Hotel → HR | `GET employees?updated_since=` | Fallback sync |
| HR → Hotel (later) | event `payroll_run.posted` | Optional cost posting to hotel Finance (Phase 5, not in scope) |

A hotel is registered in HR as an **establishment** by its existing `hotels.org_ref`.

## 6. HR app data model (own DB)

Built by moving `apps/hotel/src/lib/server/db/schema/hr.ts`, then:

- `organizations` (company: `org_ref`, legal name, TIN) — one row now, kept for portability.
- `establishments` (`org_ref` — a hotel's `hotels.org_ref` or a new one for a non-hotel business, name,
  `kind` hotel|business, timezone, night-diff window config). Replaces every `hotel_id` FK; timezone
  lives here (DTR business date, roster week).
- `employees` (company-wide, `person_ref`, `employee_no` unique per organization, identity, employment,
  pay, gov IDs, disbursement) — no `hotel_id`.
- **`employee_assignments`** `(employee_id, establishment_id, start_date, end_date, is_primary, position,
  department, biometric_enroll_id)` — effective-dated; business visibility = active assignment.
  Biometric enroll ID moves here (a person can have a different device ID at each site).
- Approvals as columns on the existing tables: `leave_requests`, `overtime_requests`, `calendar_days`
  get status `draft|submitted|approved|rejected|cancelled` + `submitted_*`, `decided_*`, `decision_note`.
  Existing rows migrate as `approved`.
- `schedule_periods(establishment_id, week_start, status, …)` — approval per business-week.
- `dtr_submissions(establishment_id, cutoff_start, cutoff_end, status draft|submitted|received|returned)`.
  `received` locks the business's DTR rows; Main HR may `return` with a note.
- `payroll_runs` company-wide; `payroll_run_lines` keep one line per person with `cost_by_establishment`
  (split from `dtr_entries.establishment_id`); `payslips.released_at`.
- `leave_types` owned by the organization (one policy); balances company-wide.
- Unchanged logic: biometric import, DTR pairing, night diff, leave/holiday effects, roster rules.

## 7. HR app authorization

Own `users`/`sessions`/`memberships`/roles (same RBAC pattern as the hotel app: DB-backed roles,
`requireCap`).

| Role | Scope | Capabilities (summary) |
|---|---|---|
| `main_hr` | organization | all HR: employees, assignments, approve, payroll, payslips, settings |
| `business_manager` | assigned establishments | view assigned staff, build/submit roster, file leave/OT, DTR, payslip download, memo proposal |
| `hr_clerk` | assigned establishments | as manager, without memo/approval-facing settings (optional) |
| `owner_readonly` | organization | read-only reports |

Every query scopes by the membership's establishment set; approval and payroll caps exist only on
`main_hr`. Tests: a manager of business A gets 403 on business B's data and on any approve/payroll route.

## 8. Changes to the hotel app

Remove (one clean deletion; **after** the data decision in §12 Q1):
- Routes: `[hotel]/management/hr`, `payroll`, `settings/leave`; `[hotel]/print/dtr`, `print/schedule`.
- Nav item "HR" and `hr:*`, `employee:*`, `schedule:*`, `dtr:*`, `leave:*`, `payroll:*` caps from
  `PERMISSION_CATALOG` / seeded roles (backfill existing role rows); `hr` role retired.
- `lib/server/hr/*`, `schema/hr.ts` tables (drop migration), `roster.ts`, `leave.ts`, `overtime.ts`,
  `hr-import.ts` and their tests.
- Team page (`settings/team`): replace the "Linked employee" picker (`listEmployeesForLinking`,
  `linkMemberToEmployee` — the only callers outside HR) with the HR-API picker on Add staff; add
  `person_ref` to `memberships`/`invites`; handle `employee.updated`. Nothing else in the hotel
  reads HR.
- `docs/TODO.md` Phase 4 rewritten to point here.

Hotel gains: HR client (API key + base URL setting), `person_ref` columns, event receiver.

## 9. Extraction approach — move, don't rewrite

1. **Commit current HR WIP first** — done: `c4c658b`, branch/tag `pre-hr-split-2026-10-13`.
2. Create `apps/hr` (SvelteKit 2 / Svelte 5 / Drizzle, same conventions) with its own `drizzle/`.
3. `git mv` HR server code, pure helpers, schema, routes, tests; rename `hotelId` → `establishmentId`.
4. Replace the two out-of-module imports found in the audit with local copies:
   `wallTimeToUtcMs` (was `server/cancellation`, which drags in PayMongo/folio/finance) and
   `businessDateFor` (was `server/finance/shared`).
5. HR reads of `hotels.config` (night-diff) → `establishments` settings; `memberships`/`roles` use →
   HR's own tables.
6. Hotel deletion (§8) as a separate, reviewable change.

## 10. Delivery phases

0. **Sign-off** §12; WIP committed (done); decide existing-data handling.
1. **HR app foundation** — scaffold, DB, auth, roles, domain mapping, establishments, API key plumbing.
2. **Extract existing HR** into `apps/hr` (employees, schedule, leave, OT, DTR, biometric, settings)
   running on the new DB, with approval statuses defaulting to `approved` (parity with today).
   **Done 2026-10-13** on `feature/hr-app`. Routes are `/{slug}/…` and `/print/{slug}/…`; payroll
   pages/tables were deliberately not moved (phase 8); employees stay per-establishment until phase 3.
3. **Central registry + assignments** — organization-wide employees, `employee_assignments`,
   business-scoped views, assignment-based biometric match.
   **Done 2026-10-13** on `feature/hr-app`: employees are company-wide (`employee_no` unique per
   organization); post, department and device ID live on the assignment; roster, DTR, leave and
   import follow an open assignment. `/people` is the registry (assign, end, set home). Leave policy
   stays per-establishment until phase 4.
4. **Approvals** — statuses, `schedule_periods`, manager submit actions, Main HR inbox.
   **Done 2026-10-13** on `feature/hr-app`: leave, overtime and memos carry
   `submitted → approved|rejected` (+ withdraw); roster weeks `draft → submitted → approved|returned`;
   `/approvals` is Main HR's inbox with a sidebar count. Managers file/submit; only `approved`
   reaches the DTR. A manager edit to a submitted/approved week reopens it as draft; Main HR edits keep
   the state (audit-logged). Overtime gained its first screen (`/{slug}/overtime`).
5. **DTR submission/receive/return.**
6. **Hotel integration** — API + events, `person_ref` columns, Team picker, auto-suspend, fallback sync.
7. **Hotel HR removal** — delete routes/code/tables, caps backfill.
8. **Payroll + payslips** — company-wide run, release, business download.
   ⚠ **Blocker independent of this plan:** `@mm/hr-core/statutory` (SSS/PhilHealth/Pag-IBIG/BIR) and
   `compute.ts` still throw; "Generate lines" refuses by design. Phase 8 cannot produce real numbers
   until the tables are filled and checked against current circulars. Phases 1–7 don't depend on it.

Phases 1–5 ship in the HR app while the hotel's own HR keeps running; 7 only after 6 is proven.

## 11. Audit basis (read-only, 2026-10-13)

HR was already well bounded: no finance/dining/folio/booking code imports `lib/server/hr/*` or queries
HR tables; HR tables FK only to `hotels` (15), `users` (11) and each other; only 5 files outside HR
folders import HR server code (payroll routes, settings/leave, settings/team, `hr-import.ts`).
Leaks: `dtr-import.ts` → `server/cancellation` (transitive PayMongo/folio/finance) and
`server/finance/shared`; HR reads `hotels.config` and `memberships`/`roles`. Payroll→Finance posting
isn't built, so nothing to untangle there.

## 12. Defaults assumed — need confirmation

1. **Existing HR data in the hotel DB:** *default* — discard. Checked in the local dev DB on
   2026-10-13: 2 employees (`EMP-100`, `EMP-001`; one linked to a login), 22 schedule rows
   (2026-10-01 → 10-30), 12 DTR entries, 9 biometric punches, 1 leave request; no OT, payroll,
   cash advances or payslips. Looks like test data. **Not checked: any other (production/staging)
   database.** Drop migration is destructive — do not run it without confirmation and a fresh dump.
2. **Invite without employee link:** *default* — allowed for `hotel_admin` and external accounts only;
   ordinary staff must link to an employee.
3. **Manager logins:** *default* — hotel login unchanged, separate HR login; SSO deferred.
4. **Hotel managers seeing salary:** *default* — payslip download only, gov IDs masked.
5. **Post-approval edits:** *default* — change to an approved week/leave/OT re-enters `submitted`;
   payroll refuses periods with unapproved weeks.
6. **Main HR overrides:** *default* — Main HR may edit rosters/DTR directly with an audit note.
7. **One Main HR team** (no per-business payroll approvers).

## 13. Risks

- **Two logins** for managers — friction; mitigate with same-email onboarding and clear links.
- **HR down** blocks the Team picker and offboarding sync — fallback pull + invite-by-email policy.
- **Lost history** if existing HR data is real and discarded — resolve §12 Q1 before step 7.
- **Duplicated pure helpers** between apps — acceptable; revisit a shared package only if they change.
- **Salary privacy** — payslips contain pay and IDs; scope by establishment, mask, audit downloads.
- **Backfill/uniqueness** — `employee_no` collisions when merging per-hotel numbering; employee entered
  at two hotels today = two rows (needs a merge report).
- **Statutory blocker** (§10) — payroll numbers can't ship until completed and verified.
- **Shared server** — both apps on one box: separate processes, ports, DB roles, uploads dirs
  (never share the uploads directory).

## 14. Verification (when built)

- Business manager A sees only A's staff; 403 server-side on B and on approve/payroll.
- Roster: submit week → Main HR approves → locked; reject → editable again.
- Biometric `ATTLOG.TXT` per establishment → DTR → submit → received (locked) → returned → editable.
- Leave/OT affect DTR only once approved; unapproved OT lands in `unapproved_ot_minutes`.
- Hotel Team: picker lists only employees assigned to that hotel; invite carries `person_ref`.
- Separate an employee in HR → hotel membership suspended; HR stopped → hotel bookings/front desk
  unaffected, Team picker shows a clear error, invite-by-email path per policy.
- Hotel app after removal: build, typecheck and existing tests pass; no `server/hr` imports remain;
  HR tables gone only after the data decision.
- Payroll (after statutory work): company run, cost-by-establishment correct, payslip hidden until
  released, then downloadable at the right business only.

## 15. Transition checklist (verified against the code, 2026-10-13)

**Verified — assumptions that held**
- The only hotel code that links accounts to employees is `settings/team` (`listEmployeesForLinking`,
  `linkMemberToEmployee`). Nothing else outside HR calls them.
- Leave and OT effects consume **only** `status = 'approved'` (`eq(..., 'approved')` in
  `leave.ts` and `overtime.ts`), so the new `draft|submitted|rejected` states are ignored by DTR/payroll
  automatically. Cancel paths use `ne(..., 'cancelled')` — re-check when adding states.
- Finance's `payroll` expense group and `counterpartyType: 'employee'` (shift-variance chargeback)
  use **user ids / category codes, not HR employee ids**. They stay in the hotel untouched.
- No membership holds the `hr` role in the dev DB (the role row exists once per hotel, 2 hotels).

**Hotel removal inventory** (everything found outside the HR folders)
- `lib/authz.ts`: `hr` role, `hr:read` in `isKitchenOnly`/`isDiningOnly`, HR caps and catalog entries
  (`employee:*`, `schedule:*`, `dtr:*`, `leave:*`, `payroll:*`, section "HR & Employees"/"Payroll").
- `management/+layout.svelte` nav item "HR"; `dashboard/+page.server.ts` `canHr` (and its Svelte use).
- `management/payroll/*`, `management/settings/leave/*`, link to it in `settings/+page.svelte`.
- `print/dtr`, `print/schedule`, `lib/components/print/{dtr-print,roster-print}.svelte`.
- `lib/{roster,leave,overtime,hr-import}.ts` and their tests.
- `hr` role rows (`roles`) per hotel — memberships must be reassigned/removed before deleting
  (`memberships.role_id` is `ON DELETE RESTRICT`), then the role seed removed from `seed-roles.ts`.
- `docs/TODO.md` Phase 4, `docs/standards/hr.md` pointers.

**Do not remove:** finance `payroll` category/ledger accounts, `counterpartyType: 'employee'`,
`@mm/hr-core` (shared by the HR app).

**Order that keeps the hotel working at every step**
1. HR app runs alone on its own DB (phases 1–5) — hotel untouched.
2. Hotel integration added (phase 6): new nullable columns + picker + inbound event endpoint. Old
   linker still works until the picker is verified.
3. Only then delete hotel HR (phase 7): code and routes first, **tables last**, after a fresh dump.
4. Retire the `hr` roles last; ensure no membership still points at one.

**Still unchecked / needs a decision**
- Any non-local (staging/production) hotel database with real HR rows.
- `docs/standards/hr.md` content vs. the new shape (not read).
- Whether the existing linked login (`EMP-001`) should be re-linked by `person_ref` during import.
- Statutory tables (phase 8 blocker) — unchanged by this transition.
