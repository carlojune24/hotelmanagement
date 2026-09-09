---
version: 1
slug: "src-routes-hotel-print"
primary_target: "src/routes/[hotel]/print"
related_targets: []
---

# Surface: Printed accountable-form documents (`src/routes/[hotel]/print`)

**Scope:** the printable / PDF documents the hotel issues from a folio — Invoice,
Official Receipt, X-reading, Z-reading, and the OR-liquidation register. One shared
template family, rendered identically for a guest (order `access_token`) and for
staff (`folio:read` / finance caps), and to PDF via Playwright `chromium.pdf`.
The `/{slug}/finance/bir` management screens are **not** this surface — they inherit
the existing staff shadcn/oklch shell and need no new design.

**Visitor mode:** Read (understand a financial record) under hard Operate constraints
(staff task; deterministic PDF; byte-identical guest vs staff output).

**Audience & job:** a guest keeping proof of what they paid, in a form their own
accounting will accept; a cashier/accountant issuing and accounting for BIR
accountable forms. Success = a document that reads as an official Philippine
accountable form, reconciles exactly with `folio.ts` / `pricing.ts`, and prints and
photocopies cleanly in black and white.

**Proof / content:** real folio charges, real payments, per-hotel VAT rate, centavo
math, per-hotel BIR identity (TIN, ATP/permit no., accredited printer, registered
serial range). No fabricated totals, no marketing copy.

**Constraints:**
- BIR-registered **serial ranges**, not a perpetual counter — numbers are drawn from
  the active `document_series` row and never cross series; a new ATP means a new
  series (possibly new prefix/start).
- Every serial is accountable: `unused | issued | cancelled | spoiled`. Cancelled and
  spoiled numbers stay dead and are retained.
- Serial assigned inside the finalizing transaction (check-out for Invoice, payment
  for OR) — no gaps from a failed render. Reprints are deterministic, same number.
- Compliant-shaped but config-driven: full statutory footer when the hotel's BIR
  data is set; a single honest "computer-generated, not BIR-registered" line until
  then (mirrors the current `/print/receipt` disclaimer).
- ~A4, ≤~120 KB PDF, only the two self-hosted fonts subset-embedded, zero external
  requests, `print-color-adjust: exact`.

**Memorable moment:** the double-ruled outer frame plus the brick-red serial number
and document-type word top-right — the instantly-recognisable "this is an accountable
form" cue, on an otherwise ink-on-white ruled page.

**Unresolved decisions:** issued-documents list placement (`finance/bir` vs
`finance/reports`); exact page-2 continuation treatment for a folio that overflows.

## Direction contract

**THESIS.** The document is authoritative because it is spare, ruled and serial-numbered
— a Philippine BIR-registered accountable form — not because it is branded. Refuses the
category default of a "nice branded PDF receipt" with logo watermark, accent panels and
a Thank-You hero.

**OWN-WORLD.** Ink `#1a1a1a` on pure white. One non-ink colour: accountable-form brick
red `#a3272e`, used only for the serial number and the document-type word. Hotel accent
permitted in exactly one 2px rule under the letterhead (falls back to ink if too light).
Fine double-rule outer frame, ~10mm margins. Inter for labels/structure; JetBrains Mono
(tabular figures, right-aligned) for every amount, serial, date. No serif display, no
shadows, no rounded corners, no fills. A boxed amount-in-words row.

**STORY.** The reader sees a document they recognise as official, finds the serial number
and the total in seconds, and can reconcile every line against what they were charged or
paid. Staff can account for every serial in a registered range.

**FIRST VIEWPORT.** Top band: letterhead lockup left (logo if set, legal/trade name,
address, TIN line); document-type word + `No. OR-000123` in large mono + dates +
preparer, right, in brick red. Below: bill-to block (guest, booking ref, stay dates).
Then the ruled line-item ledger. Bottom-right: the totals ladder (VATable / exempt /
zero-rated → VAT → total → less payments → balance due). Amount-in-words box, signature
lines, statutory-or-disclaimer footer. Whole page inside the double-rule frame.

**FORM.** Single fixed-layout print page, shared by all five document types with a
per-type header/body/totals variation. Shaped directly from the `shape` interview — a
precisely specified narrow request, no concept roll (permitted by new-work.md). Code-led:
no comp.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
