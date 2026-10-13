# PRODUCT.md

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff only — no public or guest surface.

- **Main HR** (company-wide): registers employees across the company, assigns them to businesses, approves schedules / leave / overtime / memos, receives each business's DTR, runs payroll and releases payslips.
- **Business managers and HR clerks** (per establishment, hotel or not): submit the roster, file leave and overtime, upload biometric data and generate the DTR, view only their assigned staff, and download released payslips.

## Product Purpose

The company's single HR system of record. A separate app and database from the hotel platform; the two talk only through an API (see `docs/HR_PLAN.md`). Success = Main HR can run a clean cutoff — approved rosters, received DTRs, one payroll — without chasing each business.

## Positioning

Not part of the hotel booking product. HR-only: no POS, Finance or Dining. Businesses that are not hotels exist only here.

## Capabilities and Constraints

- Built: sign-in, shell, establishments registry (phase 1); employees, roster + shift templates, leave policy/requests/balances, holiday calendar, overtime, biometric import and DTR with printable DTR/roster, night-differential settings (phase 2, moved from the hotel app with parity behaviour). People are company-wide with dated assignments to establishments (phase 3); DTR hand-off (phase 5) and payroll with payslips (phase 8), government coverage, remittances and a loans ledger (SSS / Pag-IBIG / company, auto-deducted per cutoff) are built; a manager or clerk's sidebar is their establishment's menu (with a switcher if they have several), opening on a Dashboard — today's roster, who is on leave, what needs attention, and announcements Main HR posts under Announcements; statutory rates must be confirmed by a person each run (`docs/HR_PLAN.md` §10).
- Approvals (phase 4): managers submit rosters and file leave, overtime and memo proposals; Main HR decides them from the Approvals inbox. Main HR filing is approved on the spot. Only approved items affect rosters, DTRs and balances. A manager sends each month's saved DTR to Main HR, which locks it until received or returned. Employee writes and leave policy stay with Main HR.
- Hotel and HR are authorities for different things: HR for people, hotel for logins. HR never grants hotel access. A hotel reads HR through one read-only endpoint with a per-establishment key Main HR issues (Settings → Hotel connection); it receives name, post, email and status only.
- Payroll is computed from received DTRs, one run per company cutoff and one batch per establishment. The statutory tables are encoded from published schedules but **not verified against current circulars** — Main HR confirms them each run.

## Product Principles

- Scanability over expression; this is a task tool.
- Show a thing only to someone who may use it — navigation is capability-gated, never disabled stubs.
- Never show a figure that is not real.

## Accessibility & Inclusion

WCAG AA contrast on every surface including frosted panels; full keyboard operation; touch targets at least 44px on mobile.
