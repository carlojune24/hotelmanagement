# Session log — 2026-09-08

Client-flow reconciliation + the BIR accountable-forms module (Steps 1–3).
Full detail lives in `docs/TODO.md` (Phase 1 → "Client flow reconciliation" and the
"Accountable-forms module" bullet) and the plan
(`~/.claude/plans/lets-plan-this-out-logical-dragonfly.md`, item 7a). This file is
the narrative index.

---

## 1. Client flow reconciliation (`docs/mmhotel_flow.png`)

Reconciled the client's flow diagram against what's built. Almost everything on the
diagram exists; the gaps are concentrated in guest communications, booking mutation,
and the "dashboard" half of "Reports/Dashboard". Wrote a **"Client flow
reconciliation"** subsection at the top of Phase 1 in `docs/TODO.md` with 10 gap
items, and adjusted the plan (Phase 1 items 5/7/8/9 + "Done when" + cross-cutting
audit-log line).

Decisions taken with the user:
- **"MONGOPAY"** in the diagram = **PayMongo** (client shorthand). No processor change.
- **Email only for MVP.** SMS is post-MVP (needs a PH provider — Semaphore / Movider / Twilio).
- **Occupancy % / ADR / RevPAR** stay Phase 5; **full guest directory / CRM** stays Phase 2. MVP gets a basic staff dashboard only.

Gap items now in the TODO (not yet built, unless noted): guest confirmation email ·
**accountable-forms module (built — see §3)** · guest self-service manage-booking ·
staff cancel booking · staff mark no-show · modify booking / extend stay · basic
staff dashboard · payment failure/expiry handling in the webhook · in-hotel
audit-log viewer · registration card / ID capture.

---

## 2. Impeccable-for-new-pages workflow rule

The user asked that **every new page / reshaped UI go through the `impeccable` skill
first**, so they can approve the design direction before the build.

- New `CLAUDE.md` at the repo root records the rule + the two established design
  worlds (guest "Woven Ledger" `/{slug}/book`; staff shadcn/oklch operate-mode).
- Saved to memory: `feedback_impeccable_for_new_pages.md`.

---

## 3. BIR accountable-forms module

Scope grew from the TODO's "invoice + OR per-hotel series" line during a `shape`
interview. It's now a real Philippine BIR accountable-forms system. Build order
(i)+(ii)+(iii) done this session; (iv) deferred.

### Design pass (impeccable, `shape` → direction contract → finish review)
- Surface brief + direction contract: `apps/hotel/.impeccable/surfaces/src-routes-hotel-print.md`.
- World: **"The Accountable Form"** — ink `#1a1a1a` on pure white, one brick-red
  `#a3272e` confined to the document-type word + serial number, fine double-rule
  frame, Inter for structure + JetBrains Mono for every figure, boxed
  amount-in-words, statutory-or-disclaimer footer. No serif, no shadow, no rounded
  corners, no fills.
- **Finish review: `ship`** (Step 1). 5 material fixes applied + scored resolved
  (`@page` A4 margin · print-mode `.af-frame` min-height so the ruled filler fills
  the sheet · `break-inside: avoid` guards · `formatSerial` grouping `INV-000001` ·
  removed a branded footer line) + an `ORIGINAL` / `REPRINT` copy tag.
- **DESIGN.md** now carries `# Design System: MM Hotel — Accountable Forms (print)`
  as a delimited section beside the intact Woven Ledger world (7 named rules).

### Step 1 — series + issuance core + Invoice/OR (migration `0021`)
`schema/documents.ts` — `bir_settings`, `document_series` (BIR-authorized serial
ranges, not a perpetual counter), `documents` (issued Invoice/OR + snapshot frozen
at issue; `status` covers `issued | cancelled | spoiled`).
`lib/server/finance/documents.ts` — `allocateSerial` (row-locked, gapless, flips a
series to `exhausted`), `issueInvoice` / `issueOfficialReceipt` (idempotent),
`buildInvoiceSnapshot`, `amountInWords`, `formatSerial`, series + settings CRUD.
Shared `lib/components/print/accountable-form.svelte`.
Routes `/{slug}/print/{invoice,receipt}/[documentId]` (staff `folio:read` or guest
`?t=<order token>`; receipt also accepts a raw `paymentId` for staff — replaces the
old thermal `/print/receipt/[paymentId]`). `/{slug}/finance/bir` section
(Setup / Series / Documents). Eager non-fatal issuance wired into `checkOutBooking`
(invoice) and `recordPayment` (OR), gated on the `autoIssue*` toggles; lazy
issue-on-first-print fallback. `seedFinanceDefaults` seeds a `bir_settings` row.

### Step 2 — liquidation
`cancelDocument` (issued → `cancelled`, dead number kept, optional
`issueReplacement` that links `replaces`/`replacedBy`; **document-only** — the
payment/folio is untouched) and `spoilSerial` (consumes the next serial as a
`spoiled` row, no transaction). `assembleLiquidationRows` (pure, unit-tested —
consecutive `unused` collapse into one range row) + `getLiquidationRegister`.
**Accountable forms** tab (series picker, summary tiles, register, "Spoil next
serial"); **Cancel** per issued row on the Documents tab. Printable register
`/{slug}/print/liquidation/[seriesId]`. Print routes reject a `spoiled` doc (404)
and render a `cancelled` one with an ink `CANCELLED` tag. Gated `finance:write`.
**Also:** `issueOfficialReceipt` no longer auto-issues an Invoice — it only
references one that already exists (a payment is always receiptable on its own;
issuing an Invoice stays a deliberate act). Verified: OR-000001 → cancelled +
OR-000002 replacement; OR-000003 spoiled; register + printout correct.

### Step 3 — X/Z readings (migration `0022`)
`z_readings` table (per-hotel monotonic `z_counter`, serial spans, sales / VAT split
/ discounts / voids / refunds / net, running `prev` → `new` grand total, tender
breakdown). `lib/server/finance/readings.ts` — `computeReadingData` (shared X/Z
math; cash-basis on `daySnapshot` gross; VAT extracted VAT-inclusive from
`hotels.vat_rate_bps` when VAT-registered), `getXReading`, `issueZReading`,
`getZReadingView`, `listZReadings`. **Wired into `runDayClose`** via a deferred
`import()` (breaks the `dayclose ↔ readings` cycle), non-fatal; re-closing a
reopened day issues a fresh Z. **Readings** tab (today's X + date picker + print;
Z list; "Generate Z for a closed day" fallback, `dayclose:run`). Slips at
`/{slug}/print/reading/x?date=` and `/{slug}/print/reading/z/[zReadingId]`
(`reading-slip.svelte`). Verified: day-close on 2026-09-08 auto-issued Z No. 1; an X
on 2026-09-07 (₱501 gross) split 447.32 vatable + 53.68 VAT.
`scripts/seed-bir-sample.ts` now also sets `hotels.vat_rate_bps` to 1200 when it's 0
(the demo hotel shipped with 0).

### Deferred — Step 4
Server-side PDF render (`lib/server/pdf/render.ts`, Playwright/Chromium — ~150 MB
dep) + attaching the Invoice/OR PDF to the confirmation email. Browser "Save as PDF"
covers every print route today. The `@page` margins / `preferCSSPageSize` must be
honored when the `pdf()` path is built.

### Dev helpers
`apps/hotel/scripts/seed-bir-sample.ts` (compliant BIR setup + active series +
sample doc URLs; re-runnable) and `apps/hotel/scripts/reset-bir-sample.ts` (wipes
issued documents + z-readings, resets series counters).

---

## State at end of session
- `pnpm check` clean, `pnpm test` 48 pass. Migrations `0021` + `0022` applied to the local dev DB.
- Demo hotel `hotel1`: `vat_rate_bps` now 1200; 2026-09-08 day-closed with Z No. 1; a BIR series + settings seeded.
- Nothing committed — all work is in the working tree.

## Next
`build order (iv)`, or another Phase-1 client-flow gap: **booking mutation** (staff
cancel / no-show / modify-extend-stay), **guest self-service manage-booking**, or the
**basic staff dashboard**.
