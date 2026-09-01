/** Shared Tailwind class recipes so every screen looks like one system. */
export const ui = {
	page: 'mx-auto w-full max-w-5xl px-4 py-8 sm:px-6',
	card: 'rounded-xl border border-border bg-surface-2 p-5 shadow-sm',
	h1: 'text-xl font-semibold tracking-tight text-ink',
	h2: 'text-sm font-semibold uppercase tracking-wide text-ink-muted',
	label: 'block text-sm font-medium text-ink',
	input:
		'mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30',
	select:
		'mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30',
	btn: 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50',
	btnPrimary: 'bg-brand text-brand-ink hover:opacity-90',
	btnGhost: 'border border-border bg-surface text-ink hover:bg-surface-2',
	btnDanger: 'bg-danger text-white hover:opacity-90',
	alertErr: 'rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger',
	alertOk: 'rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok',
	table: 'w-full text-left text-sm',
	th: 'border-b border-border px-3 py-2 font-medium text-ink-muted',
	td: 'border-b border-border/60 px-3 py-2 text-ink',
	badge: 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium'
} as const;
