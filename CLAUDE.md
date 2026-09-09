# mmhotel — working notes for Claude

Multi-hotel management + online booking platform. SvelteKit 2 / Svelte 5 / TS, Drizzle +
local Postgres, pnpm monorepo (`apps/hotel` + `packages/{hr-core,finance-core,integration}`).
Phased plan: `~/.claude/plans/lets-plan-this-out-logical-dragonfly.md`. Live checklist:
`docs/TODO.md`.

## Design workflow — required

**Before building any new page, or reshaping/redesigning an existing UI surface, run the
`impeccable` skill first and present its design direction (tokens, layout, which "world"
it belongs to) so the design is approved up front — never hand-roll a new screen straight
into code.**

Two established design worlds — a route never crosses between them:

| World | Routes | Look | Source |
|---|---|---|---|
| **Guest booking** — "Woven Ledger" | `/{slug}/book/...` | Literata / Inter / JetBrains Mono; ruled guest-register aesthetic; hotel accent color spun into a woven pattern | `apps/hotel/DESIGN.md`, `apps/hotel/.impeccable/surfaces/` |
| **Staff app** — operate mode | `[hotel]/(staff)/...`, `/admin` | Neutral `shadcn-svelte` (bits-ui) + oklch tokens in `apps/hotel/src/app.css` | shadcn primitives under `apps/hotel/src/lib/components/ui/` |

New guest surface → extend the Woven Ledger world. New staff surface → run `impeccable` to
produce/confirm the operate-mode direction for it, then build.

## Other conventions

- Money is integer **centavos** everywhere. Dates: every hotel has an IANA `timezone`; business date resolved from it.
- Server-only code under `src/lib/server/`; DB schema split under `src/lib/server/db/schema/` then re-exported from `index.ts`.
- Tenant scoping: every tenant table carries `hotel_id`; queries scope by it. RBAC via `requireCap` / `src/lib/authz.ts`.
- Finance module (`/{slug}/finance`) is deliberately **cash-basis**; `recordCashMovement` is the single cash choke point. Double-entry / `@mm/finance-core` is deferred to Phase 5.
- `PRODUCT.md` / `DESIGN.md` in `apps/hotel/` carry impeccable's product + design schema — keep them current when a surface ships.
