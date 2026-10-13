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

- Phase 1 (this build): sign-in, app shell, establishments registry. Employees, roster, leave, OT, DTR, payroll arrive in later phases (`docs/HR_PLAN.md` §10).
- Hotel and HR are authorities for different things: HR for people, hotel for logins. HR never grants hotel access.
- Payroll numbers are blocked on the statutory tables in `@mm/hr-core` (not yet filled in).

## Product Principles

- Scanability over expression; this is a task tool.
- Show a thing only to someone who may use it — navigation is capability-gated, never disabled stubs.
- Never show a figure that is not real.

## Accessibility & Inclusion

WCAG AA contrast on every surface including frosted panels; full keyboard operation; touch targets at least 44px on mobile.
