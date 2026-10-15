<script lang="ts">
	// Sales per business day across the selected range, so the trend reads at a glance.
	// Plain bars from a zero baseline; the tooltip (and the table below) carry the exact figures.
	interface Day {
		date: string;
		orders: number;
		grossCentavos: number;
	}

	let { days }: { days: Day[] } = $props();

	const H = 120;
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const tick = (s: string) => {
		const [, m, d] = s.split('-');
		return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
	};

	const max = $derived(Math.max(1, ...days.map((d) => d.grossCentavos)));
	const total = $derived(days.reduce((s, d) => s + d.grossCentavos, 0));
	const slotW = $derived(days.length > 0 ? 100 / days.length : 100);
	const barW = $derived(Math.min(4, Math.max(0.4, slotW * 0.6)));
	let hovered = $state<number | null>(null);
	const hoveredRow = $derived(hovered != null ? days[hovered] : null);
	const tickIdx = $derived(
		days.length <= 1
			? days.map((_, i) => i)
			: [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i)
	);
</script>

<figure class="m-0" role="img" aria-label="Daily dining sales. Total for the range: {peso(total)}.">
	<div class="relative overflow-x-auto">
		<svg
			width="100%"
			height={H}
			viewBox="0 0 100 {H}"
			preserveAspectRatio="none"
			style="min-width: {Math.max(320, days.length * 12)}px; display:block;"
			onmouseleave={() => (hovered = null)}
			role="presentation"
		>
			<line x1="0" y1="1" x2="100" y2="1" stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="2 3" />
			<line x1="0" y1={H - 1} x2="100" y2={H - 1} stroke="var(--border)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
			{#each days as d, i (d.date)}
				{@const h = (d.grossCentavos / max) * (H - 6)}
				<rect
					x={i * slotW + (slotW - barW) / 2}
					y={H - 1 - h}
					width={barW}
					height={Math.max(h, d.grossCentavos > 0 ? 0.5 : 0)}
					fill="var(--primary)"
					opacity={hovered == null || hovered === i ? 1 : 0.5}
				/>
				<rect x={i * slotW} y="0" width={slotW} height={H} fill="transparent" role="presentation" onmouseenter={() => (hovered = i)} />
			{/each}
		</svg>
		<div class="pointer-events-none absolute top-1 right-2 font-mono text-[10px] text-ink-muted">{peso(max)}</div>
		{#if hoveredRow}
			<div
				class="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-sm"
				style="left: {Math.min(88, Math.max(12, (hovered! + 0.5) * slotW))}%; top: 4px;"
			>
				<div class="font-medium text-ink">{tick(hoveredRow.date)}</div>
				<div class="flex justify-between gap-3 text-ink-muted"><span>Sales</span><span class="font-mono text-ink">{peso(hoveredRow.grossCentavos)}</span></div>
				<div class="flex justify-between gap-3 text-ink-muted"><span>Orders</span><span class="font-mono text-ink">{hoveredRow.orders}</span></div>
			</div>
		{/if}
	</div>
	<figcaption class="mt-1.5 flex justify-between font-mono text-[10px] text-ink-muted">
		{#each tickIdx as i (i)}<span>{days[i] ? tick(days[i]!.date) : ''}</span>{/each}
	</figcaption>
</figure>
