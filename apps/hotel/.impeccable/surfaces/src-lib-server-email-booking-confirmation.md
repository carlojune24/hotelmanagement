---
version: 1
slug: "src-lib-server-email-booking-confirmation"
primary_target: "src/lib/server/email/booking-confirmation.ts"
related_targets:
  - "src/lib/server/email/send-booking-confirmation.ts"
  - "src/routes/api/webhooks/paymongo/+server.ts"
---

# Surface: Guest booking-confirmation email (`src/lib/server/email/booking-confirmation.ts`)

**Scope:** the single transactional HTML email a guest receives after an online
booking's PayMongo payment is confirmed. `renderBookingConfirmation(data)` is a
pure function returning `{ subject, html, text }`; `send-booking-confirmation.ts`
gathers the order and hands it to the nodemailer transport; the PayMongo webhook
fires it once, best-effort, on the delivery that flips the order to `confirmed`.
No other transactional mail exists yet (cancellation, BIR PDF attachment, staff
resend UI are future work on the same module).

**World:** Guest Booking — "Woven Ledger" (`apps/hotel/DESIGN.md`). This email is
the **Confirmation Ticket** signature component relocated from the confirmation
screen to the inbox.

**Visitor mode:** Read — a receipt the guest verifies and keeps. `mmhotel` is
invisible; the mail reads as *that hotel's*.

**Audience & job:** the guest who just paid, confirming their stay is real and
knowing what happens next. Success = they can see at a glance that it worked, keep
the confirmation code, and find their way back to the booking.

**Content (all real, from the order):** hotel name + address + city, confirmation
code (`order.id.slice(0,8).toUpperCase()`), guest name, stay dates + nights,
room type(s) + rate plan + quantity, function-hall line(s), standard check-in /
check-out clock times, subtotal / fees / VAT / total-paid breakdown (reconciles
with `pricing.ts`), and a link to the existing `/{slug}/book/confirmation/[orderId]?t=…`
page. Per-hotel `branding.accentColor` / `paperColor` / `logoUrl` drive the look.

**Constraints (email medium):**
- Table-based layout, 600px, every style inline, a `text/plain` alternative.
  Web-safe font stacks only (Literata → Georgia; JetBrains Mono → `ui-monospace`
  fallbacks; Inter → system sans). Outlook-conditional VML for the CTA button.
- Provider-agnostic transport from `SMTP_*` env; unconfigured = printed to the
  server console, so local dev needs no setup.
- Best-effort and idempotent: one `email_log` row per attempt (`sent` / `failed`);
  `alreadySent(orderId, type)` guards re-sends on webhook redelivery or manual
  retry. A send failure never fails the payment webhook.
- Guest-controlled text (name, room/plan names) is HTML-escaped.

**Scoped deviations from DESIGN.md, and why:** the woven frame → flat
`--hotel-accent` 6px border stripe (the nested-layer weave can't render in an
email client; the "small UI may use the flat accent directly" carve-out applies);
perforated edge dropped; "Ticket lift" shadow → 1px `--ledger-rule` frame; the
check-in/check-out manifest pair is stacked, not arrow-paired, for legibility at
600px. `--ledger-ink-muted` nudged to `#6b6155` and the default body ground set to
a warm `#f4f1ea` so the mail keeps the world's warm register and clears 4.5:1.

**Out of scope:** the confirmation *page* itself (already built); SMS (post-MVP);
attaching the BIR Invoice/OR PDF (BIR module Step 4); a staff-facing email log
viewer / resend button (the `email_log` table is the hook for it).
