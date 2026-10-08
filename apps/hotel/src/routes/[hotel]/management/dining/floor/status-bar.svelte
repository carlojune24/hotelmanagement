<script lang="ts">
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import BroomIcon from '@lucide/svelte/icons/brush-cleaning';
	import { FILTERS, type FloorFilter } from '$lib/dining-floor';

	let {
		counts,
		filter = $bindable('all')
	}: {
		counts: Record<FloorFilter, number>;
		filter: FloorFilter;
	} = $props();

	// The ones that need a person carry an icon, and a warning-coloured border when something is waiting.
	const ICON = { serve: BellRingIcon, qr: QrCodeIcon, pay: ReceiptTextIcon, clear: BroomIcon } as const;
	const URGENT = new Set<FloorFilter>(['serve', 'qr', 'pay']);
	const visible = $derived(FILTERS.filter((f) => f.key === 'all' || f.key === filter || counts[f.key] > 0 || !URGENT.has(f.key)));
</script>

<!-- Same chip language as the area and venue tabs: hairline border, brand tint when selected. -->
<div class="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Show tables">
	{#each visible as f (f.key)}
		{@const on = filter === f.key}
		{@const urgent = URGENT.has(f.key) && counts[f.key] > 0}
		{@const Icon = ICON[f.key as keyof typeof ICON]}
		<button
			type="button"
			aria-pressed={on}
			class="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors {on
				? 'border-brand bg-brand/10 font-medium text-ink'
				: urgent
					? 'border-warning/60 text-ink hover:bg-surface-2'
					: 'border-border text-ink-muted hover:text-ink'}"
			onclick={() => (filter = on && f.key !== 'all' ? 'all' : f.key)}
		>
			{#if Icon}<Icon class="size-4 {urgent ? 'text-warning' : ''}" aria-hidden="true" />{/if}
			{f.label}
			<span class="tabular-nums text-ink-muted">{counts[f.key]}</span>
		</button>
	{/each}
</div>
