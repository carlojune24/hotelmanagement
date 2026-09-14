/**
 * @mm/finance-core — canonical chart-of-accounts taxonomy, double-entry journal
 * model, the canonical cash-movement record, posting-rule interface, and
 * consolidated report builders.
 *
 * Phase 3/5 fill-in: COA taxonomy, journal draft/balance-check, posting-rule
 * interface, and report contracts. Report *builders* (the actual DB queries) and
 * posting-rule *registries* stay app-local — this package only carries the shapes
 * every MM app must agree on. See docs/standards/finance.md.
 */
export const FINANCE_CORE_VERSION = '0.2.0' as const;

export * from './coa';
export * from './journal';
export * from './posting';
export * from './reports';
