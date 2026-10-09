<script lang="ts">
	import { formatWaitShort } from '$lib/dining-orders';
	import type { BoardSummary } from '$lib/orders-board';

	let {
		summary,
		unpaidOnly = $bindable(false),
		onjump
	}: {
		summary: BoardSummary;
		unpaidOnly: boolean;
		onjump: (section: 'ready' | 'preparing' | 'new') => void;
	} = $props();

	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	// One shape for all four: a tinted, bordered button. The token colour sits on the number and the
	// edge; labels stay in ink so contrast holds in light and dark.
	const base =
		'group flex min-h-20 items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';
</script>

<div class="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Order summary">
	<button type="button" class="{base} border-ok/40 bg-ok/10 hover:bg-ok/15" onclick={() => onjump('ready')}>
		<span class="min-w-0">
			<span class="block text-sm font-semibold text-ink">Ready to serve</span>
			<span class="block text-xs text-ink-muted">
				{summary.ready > 0 ? `Longest waiting ${formatWaitShort(summary.longestReadyMinutes)}` : 'Nothing waiting'}
			</span>
		</span>
		<span class="text-3xl font-bold tabular-nums text-ok" aria-live="polite">{summary.ready}</span>
	</button>

	<button type="button" class="{base} border-warning/40 bg-warning/10 hover:bg-warning/15" onclick={() => onjump('preparing')}>
		<span class="min-w-0">
			<span class="block text-sm font-semibold text-ink">Preparing</span>
			<span class="block text-xs text-ink-muted">
				{summary.late > 0 ? `${summary.late} running late` : summary.preparing > 0 ? 'All on time' : 'Nothing cooking'}
			</span>
		</span>
		<span class="text-3xl font-bold tabular-nums text-warning" aria-live="polite">{summary.preparing}</span>
	</button>

	<button type="button" class="{base} border-brand/40 bg-brand/10 hover:bg-brand/15" onclick={() => onjump('new')}>
		<span class="min-w-0">
			<span class="block text-sm font-semibold text-ink">New</span>
			<span class="block text-xs text-ink-muted">Waiting for the kitchen</span>
		</span>
		<span class="text-3xl font-bold tabular-nums text-brand" aria-live="polite">{summary.fresh}</span>
	</button>

	<button
		type="button"
		class="{base} border-danger/40 bg-danger/10 hover:bg-danger/15 {unpaidOnly ? 'ring-2 ring-danger' : ''}"
		aria-pressed={unpaidOnly}
		title={unpaidOnly ? 'Showing unpaid orders only. Select to show everything.' : 'Select to show unpaid orders only'}
		onclick={() => (unpaidOnly = !unpaidOnly)}
	>
		<span class="min-w-0">
			<span class="block text-sm font-semibold text-ink">To pay</span>
			<span class="block truncate text-xs text-ink-muted">
				{summary.unpaid > 0 ? `${peso(summary.unpaidCentavos)} to collect` : 'All settled'}
			</span>
		</span>
		<span class="text-3xl font-bold tabular-nums text-danger" aria-live="polite">{summary.unpaid}</span>
	</button>
</div>
