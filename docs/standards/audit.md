# Audit trail convention

How a mutation is recorded so that "who did this, when, and from where" can always be answered.
App-level convention for `apps/hotel` (not a cross-app data contract like `hr.md` / `finance.md`).

## The rule

**Every mutation calls `writeAudit` with `refCode`, inside its transaction, and a guest or system
action is never logged as a staff user.**

- `refCode` is the tracking number the entry belongs to (`DN-…` order, `TB-…` reservation). Put the
  record ids (`orderId`, `reservationId`, `checkId`, `paymentId`, …) in `after` too, so a trail can
  follow them.
- Pass `tx` when the change is in a transaction, so the entry commits or rolls back with it. Without
  it `writeAudit` uses the global `db` and can outlive a rollback.
- `actor` is a signed-in user only. For a guest action pass `actor: null` (kind is inferred as
  `guest` from the request; pass `actorKind: 'guest'` to be explicit). For a webhook, expiry or other
  background step pass `actorKind: 'system'`.
- Never put secrets or card data in `before` / `after`. Guest-typed text goes in as data; anything
  exported to CSV goes through `safeCell`.

## What is captured automatically

`hooks.server.ts` runs every request inside `lib/server/request-context.ts`. `writeAudit` reads it,
so call sites do not pass these:

| Column | Source |
|---|---|
| `actor_kind` | `staff` when `actor` is given; else `system` for `/api/**` or no request; else `guest` |
| `ip_address` | `event.getClientAddress()` (truncated) |
| `user_agent` | request header (truncated) |

IP address and browser are personal data (Data Privacy Act). They are shown to hotel admins only
(`hotel:admin`); the trail builder strips them for anyone else. Rows from before these columns
existed read "Guest or system (not recorded)".

## Reading it back

- `lib/server/dining-trail.ts` — `buildDiningTrail(hotelId, ref, { admin })`: one chronological
  timeline for a DN / TB number, merging audit rows with what the tables already hold. A
  record-derived step is dropped when an audit row already covers it.
- `management/trail/[ref]` (page, `/csv`) and `print/dining-trail/[ref]` — gate `dining:read`.
- `management/settings/audit` — server-side filters, 50 per page, CSV and print (`hotel:admin`).
- Room and hall bookings can reuse the trail shape; not built yet.
