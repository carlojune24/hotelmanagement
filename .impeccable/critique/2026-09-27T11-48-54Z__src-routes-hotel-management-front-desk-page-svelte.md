---
target: front-desk staff UI - 5 minute learnability / no-mistakes audit
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-09-27T11-48-54Z
slug: src-routes-hotel-management-front-desk-page-svelte
---
Method: dual-agent (A: front-desk design review · B: front-desk detector/evidence pass)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Live overdue countdown, KPI strip, toasts on every action. |
| 2 | Match System / Real World | 4 | "Floor 2," peso amounts, GCash/Maya, business-date language. |
| 3 | User Control and Freedom | 3 | Cancel/back everywhere; walk-in cart persistence across sheet close is undocumented, no visible cart-count badge on the grid while in pick mode. |
| 4 | Consistency and Standards | 2 | Occupied and Departing share identical color tokens (`bg-ok`) in both the tile and pill; the static Quick View legend's "Departing" dot (`bg-ink-muted`, gray) doesn't match any color the tiles actually render. |
| 5 | Error Prevention | 2 | Server-side gates are solid (deposit-held, balance>0 both throw), but the Check-out button's `disabled` condition (`+page.svelte:2031`) omits the balance check the server enforces — a rushed click is only caught after a round-trip. Zero confirmation dialogs exist anywhere in the file (no `confirm()`/`AlertDialog`); void-payment, void-charge, and the housekeeping-gate admin override are all one-click. |
| 6 | Recognition Rather Than Recall | 3 | Folio/payments/history visible without recall; 4 icon-only buttons (walk-in cart qty ±, remove tile, remove cart line) carry no `aria-label`/title/text at all. |
| 7 | Flexibility and Efficiency | 4 | Status-chip quick filter, search, room-type pills, clock-shortcut links all reward speed without punishing novices. |
| 8 | Aesthetic and Minimalist Design | 2 | Worst-case occupied-room panel (unresolved housekeeping + balance due) surfaces ~26 interactive elements + ~9 informational items simultaneously, including a duplicated "Take payment" button (lines 2018 and 2314). |
| 9 | Error Recovery | 3 | Error banners are specific and money-quoted, but up to three separate blocking banners (deposit-held, balance-due, housekeeping-not-clean) can stack with no unified "here's what's left" checklist. |
| 10 | Help and Documentation | 2 | No inline help/tooltips for new staff; aria/role coverage is ~8 attributes across ~78 interactive elements (~10%), and hover-only `title` text is invisible on a touchscreen front desk. |
| **Total** | | **29/40** | **Acceptable — solid bones, but real mistake-risk at the exact moments the 5-minute/no-mistakes bar cares about most.** |

*(Score reconciled from Assessment A's independent 32/40 against Assessment B's harder evidence on consistency, error prevention, and aesthetic/minimalism — B's line-level counts moved 4, 5, and 8 down a point each.)*

#### Design Specificity Verdict

**Design review (A):** Purpose-built, not boilerplate. The room grid is a real day-tape metaphor with floor grouping and overdue-aware badges, the "Needs attention" roll-up is a genuine operational shortcut, and copy is domain-literate ("Settle deposit before checking out," city-ledger handoff). Reads like someone who has actually run a front desk.

**Deterministic scan (B):** The mechanical linter (`detect.mjs`) found zero rule violations — this file has no generic-boilerplate smell at the pattern level. The real issues live below what a linter checks: `BellIcon` is imported but never used (dead import); 4 icon-only controls (cart qty ±, remove-tile, remove-cart-line) carry no accessible name at all; only ~10% of interactive elements have any `aria-*`/`role` attribute.

No browser visualization this pass — no dev server was running and starting one was out of scope for an audit; findings above are evidence-based from source, not visual/screenshot-based.

#### Overall Impression

The screen is clearly built by someone who understands hotel front-desk work, and the server-side money/housekeeping gates are genuinely strong — a staffer cannot *actually* check out a guest past an unresolved deposit or damage report no matter what the UI lets them click. But the UI doesn't yet make the safe path the *only visible* path: the one color-and-icon distinction that matters most under time pressure (occupied vs. departing) is nearly invisible, the one button that should be pre-disabled for the most common mistake (checking out with a balance due) isn't, and the busiest state of the busiest panel throws ~35 simultaneous items at a brand-new hire with no chunking. The biggest opportunity is tightening the gap between "the server won't let you" and "the screen won't let you try" — that gap is exactly where a rushed, undertrained staffer makes the mistake this product is trying to prevent.

#### What's Working

- **"Needs attention" roll-up** (`+page.svelte:1280-1308`): collapses overdue + balance + damage into one severity-sorted, click-to-room list — exactly the right pattern so a busy desk never has to scan the whole grid to find what's urgent.
- **Absolute deadline labels, not countdowns** (`checkoutDeadline()`, `+page.svelte:249-260`): shows "Out by 12:00 PM" instead of a ticking duration, explicitly to avoid ambiguity across a shift change — a real, considered UX decision.
- **Server-side money/housekeeping gates are structurally sound** (`settleSecurityDeposit`, front-desk actions): the admin override requires the `hotel:admin` capability and is always audit-logged — the safety net is real even where the UI's own guardrails are thinner (see P0 below).

#### Priority Issues

**[P0] Occupied and Departing rooms are visually identical by color.**
Why it matters: `statusCardClass`/`statusPillClass` (`+page.svelte:480-506`) render both states as the same `bg-ok`/green, and `statusLabel` (507-513) even maps both to the literal text "Occupied." The only difference is a small corner icon (UserIcon vs. LogOutIcon). A staffer scanning 20+ green tiles for "who's leaving today" cannot do it by color or label — only by reading every tile's tiny icon. The Quick View legend makes it worse: its "Departing" swatch is gray (`bg-ink-muted`), matching nothing the tiles actually render.
Fix: give `departing` its own hue (e.g. amber/brand), a distinct label ("Departing," not "Occupied"), and fix the legend swatch to match.
Suggested command: `/impeccable colorize`

**[P0] Check-out button isn't disabled when a balance is still owed.**
Why it matters: `+page.svelte:2031`'s `disabled={!roomDetailReady || roomDeposit?.status === 'held'}` omits the balance check the server enforces one function away. The warning text above is easy to miss under stress; the button stays clickable, and the mistake surfaces only after a server round-trip + toast — exactly the moment the "staff can never make mistakes" requirement is supposed to hold.
Fix: add `formFolio.balanceCentavos > 0` to the disabled condition, mirroring the server gate exactly.
Suggested command: `/impeccable harden`

**[P1] Zero confirmation step anywhere in the file for money-moving or gate-bypassing actions.**
Why it matters: void payment, void charge, and — most notably — the "Admin override — settle anyway, skip the housekeeping check" link (`+page.svelte:2477-2487`) are all single-click, no `confirm()`/dialog. The override is also styled as the *lowest*-weight element on the screen (a bare underlined text link) directly under the primary Settle button — backwards for an action that bypasses a safety gate on purpose.
Fix: require a real confirmation step (typed room number, or a Dialog) before the override fires; promote it visually enough to signal "this is a deliberate exception," not a stray link.
Suggested command: `/impeccable harden`

**[P1] The busiest panel state overloads working memory.**
Why it matters: for an occupied room with an unresolved housekeeping flag and a balance due, Assessment B counted ~26 simultaneous interactive elements plus ~9 informational ones in one scrollable rail — including a duplicated "Take payment" button appearing twice (lines 2018 and 2314). Three separate blocking banners (deposit-held, balance-due, housekeeping-not-clean) can stack with no unified "what's left" view. A first-timer sees a wall of red text and can't tell which blocker applies to which action.
Fix: consolidate the blocking banners into one "Before you can check out" checklist with per-item resolved/unresolved state; remove the duplicate Take Payment button.
Suggested command: `/impeccable distill`

**[P2] Icon-only controls have no accessible name, and hover-only titles don't work on touchscreens.**
Why it matters: 4 controls — walk-in cart quantity ± (`3025-3045`), remove-tile (`1616-1622`), remove-cart-line (`3051-3059`) — show only an icon with no `aria-label`, `title`, or visible text. Front desks in small PH hotels are plausibly touch/tablet-first (per PRODUCT.md's own dashboard note "written first for the front desk on a tablet"), where hover title text never appears at all. Aria/role coverage overall is ~8 attributes across ~78 interactive elements (~10%).
Fix: add visible text or at minimum `aria-label` to all four; audit the rest of the file's icon-only surface for the same gap.
Suggested command: `/impeccable clarify`

#### Persona Red Flags

**Jordan (day-one front desk hire):**
- Sees 5 status chips + room-type pills + search + Quick View legend all above the grid before touching a single room — a lot to parse in the first 5 minutes.
- Genuinely can't tell a departing room from an occupied one by glancing at color (P0 above) — could fail to prompt a guest to leave on time.
- Clicks Check-out on a room with a balance due (button isn't disabled), gets a toast error, and may retry the identical click 2-3 times not understanding why nothing happened (P0 above).
- Faced with the deposit-blocked state, sees two visually-identical red banners ("Can't settle yet" — damage report vs. not-clean) and can't tell which applies without reading both closely (P1 above).

**Riley (stress-tester):**
- Triggers balance-due + deposit-held simultaneously; the server correctly blocks both, but the UI only shows warnings one at a time in a stacked list rather than a single consolidated blocker view — resolves issues by trial rather than seeing everything up front.
- Enters pick mode, selects rooms across floors, closes the sheet — the cart persists correctly, but there's no cart-count badge visible on the grid itself while scrolling floors (only in the header Walk-in button), so it's easy to lose track of how many rooms are already picked.
- Rapid-clicks "Take payment" — no visible loading/disabled state was confirmed in the reviewed code path during the round-trip, a plausible double-submit risk worth checking in the payment-fields component.

#### Minor Observations

- `BellIcon` is imported (`+page.svelte:42`) but never referenced — dead import.
- `danger` (red) is reused for at least 4 unrelated meanings: out-of-order, needs-cleaning, overdue departure, and pending-damage borders — not a one-to-one mapping.
- "Flag for housekeeping" (now relocated to the top of the panel) is a full-width, primary-weight button with no confirmation — low risk since it's non-destructive, but a toast-undo would be a nice-to-have since it does change room state.
- The detector (`detect.mjs`) itself found zero automated findings — this is a source-reading-and-counting audit, not a linter-caught-it audit.

#### Questions to Consider

- If a new hire can't tell "occupied" from "departing" by color today, is departing-today actually a distinct operational state that deserves its own visual identity, or should it be folded into a single "in-house" state with the deadline doing the work instead?
- Given the server-side gates are already solid, is the UI's job here to *prevent* the click, or just to make the consequence of the click impossible to miss before it happens?
- Is the admin-override link's current low visual weight intentional (so staff don't reach for it casually), or an oversight — and would a confirmation step change that calculus either way?
