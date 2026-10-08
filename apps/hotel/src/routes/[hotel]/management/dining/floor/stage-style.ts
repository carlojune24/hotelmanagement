import type { TableStage } from '$lib/dining-floor';

/**
 * How a table stage looks on the Floor, in the same quiet staff language as the other Dining
 * tabs: neutral surfaces and hairline borders, with a soft tint and a small dot carrying the
 * status (the word is always shown too, so colour is never the only signal). No solid fills.
 */
export const STAGE_STYLE: Record<TableStage, { tile: string; dot: string }> = {
	free: { tile: 'border-border bg-surface text-ink hover:bg-surface-2', dot: 'bg-ink-muted/40' },
	reserved: { tile: 'border-brand/40 bg-brand/5 text-ink hover:bg-brand/10', dot: 'bg-brand/60' },
	seated: { tile: 'border-brand/50 bg-brand/10 text-ink hover:bg-brand/15', dot: 'bg-brand' },
	occupied: { tile: 'border-brand/50 bg-brand/10 text-ink hover:bg-brand/15', dot: 'bg-brand' },
	needs_payment: { tile: 'border-warning/60 bg-warning/10 text-ink hover:bg-warning/15', dot: 'bg-warning' },
	ready_to_clear: { tile: 'border-ok/50 bg-ok/10 text-ink hover:bg-ok/15', dot: 'bg-ok' }
};

/** A small bordered pill for "something needs a person": white, with the icon carrying the colour. */
export const PILL = 'inline-flex items-center gap-1 rounded-full border bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-ink shadow-sm';
