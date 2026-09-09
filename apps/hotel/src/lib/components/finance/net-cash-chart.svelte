<script lang="ts">
	// Daily net cash (cash in − cash out) across the selected range. Diverging
	// around a zero baseline: bars up = net-positive day (--ok), down = net-negative
	// (--danger). The up/down position is the colour-independent encoding, so it
	// still reads under CVD; the tooltip carries the signed figure.
	interface Day {
		date: string;
		inCentavos: number;
		outCentavos: number;
	}

	let { days }: { days: Day[] } = $props();

	const H = 140; // plot height, px (viewBox y is 1:1 with pixels)
	const MID = H / 2;

	const peso = (c: number) =>
		`${c < 0 ? '−' : ''}₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const tick = (s: string) => {
		const [, m, d] = s.split('-');
		return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
	};

	const rows = $derived(
		days.map((d) => ({ ...d, net: d.inCentavos - d.outCentavos }))
	);
	const maxAbs = $derived(Math.max(1, ...rows.map((r) => Math.abs(r.net))));
	const totalNet = $derived(rows.reduce((s, r) => s + r.net, 0));
	const slotW = $derived(rows.length > 0 ? 100 / rows.length : 100);
	const barW = $derived(Math.max(0.4, slotW * 0.6));

	let hovered = $state<number | null>(null);
	const hoveredRow = $derived(hovered != null ? rows[hovered] : null);

	// A few evenly-spaced date ticks along the axis.
	const tickIdx = $derived(
		rows.length <= 1
			? rows.map((_, i) => i)
			: [0, Math.floor((rows.length - 1) / 2), rows.length - 1].filter(
					(v, i, a) => a.indexOf(v) === i
				)
	);
</script>

<figure
	class="m-0"
	role="img"
	aria-label="Daily net cash. Total for the range: {peso(totalNet)}."
>
	{#if maxAbs <= 1 && totalNet === 0}
		<div
			class="flex h-[140px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-ink-muted"
		>
			No cash movement in this range.
		</div>
	{:else}
		<div class="relative overflow-x-auto">
			<svg
				width="100%"
				height={H}
				viewBox="0 0 100 {H}"
				preserveAspectRatio="none"
				style="min-width: {Math.max(320, rows.length * 12)}px; display:block;"
				onmouseleave={() => (hovered = null)}
				role="presentation"
			>
				<!-- ± max gridlines -->
				<line x1="0" y1="1" x2="100" y2="1" stroke="var(--border)" stroke-width="1"
					vector-effect="non-scaling-stroke" stroke-dasharray="2 3" />
				<line x1="0" y1={H - 1} x2="100" y2={H - 1} stroke="var(--border)" stroke-width="1"
					vector-effect="non-scaling-stroke" stroke-dasharray="2 3" />
				<!-- zero baseline -->
				<line x1="0" y1={MID} x2="100" y2={MID} stroke="var(--border)" stroke-width="1.5"
					vector-effect="non-scaling-stroke" />

				{#each rows as r, i (r.date)}
					{@const h = (Math.abs(r.net) / maxAbs) * (MID - 4)}
					{@const x = i * slotW + (slotW - barW) / 2}
					{#if r.net !== 0}
						<rect
							x={x}
							y={r.net >= 0 ? MID - h : MID}
							width={barW}
							height={Math.max(h, 0.5)}
							fill={r.net >= 0 ? 'var(--ok)' : 'var(--danger)'}
							opacity={hovered == null || hovered === i ? 1 : 0.5}
						/>
					{/if}
					<!-- hit target -->
					<rect
						x={i * slotW}
						y="0"
						width={slotW}
						height={H}
						fill="transparent"
						onmouseenter={() => (hovered = i)}
					/>
				{/each}
			</svg>

			<div class="pointer-events-none absolute top-1 right-2 font-mono text-[10px] text-ink-muted">
				{peso(maxAbs)}
			</div>
			<div class="pointer-events-none absolute right-2 bottom-1 font-mono text-[10px] text-ink-muted">
				−{peso(maxAbs).replace('−', '')}
			</div>

			{#if hoveredRow}
				{@const left = Math.min(88, (hovered! + 0.5) * slotW)}
				<div
					class="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-sm"
					style="left: {left}%; top: 4px;"
				>
					<div class="font-medium text-ink">{tick(hoveredRow.date)}</div>
					<div class="mt-0.5 flex justify-between gap-3 text-ink-muted">
						<span>In</span><span class="font-mono text-ink">{peso(hoveredRow.inCentavos)}</span>
					</div>
					<div class="flex justify-between gap-3 text-ink-muted">
						<span>Out</span><span class="font-mono text-ink">{peso(hoveredRow.outCentavos)}</span>
					</div>
					<div class="mt-0.5 flex justify-between gap-3 border-t border-border pt-0.5">
						<span class="text-ink-muted">Net</span>
						<span
							class="font-mono font-semibold"
							class:text-ok={hoveredRow.net >= 0}
							class:text-danger={hoveredRow.net < 0}>{peso(hoveredRow.net)}</span
						>
					</div>
				</div>
			{/if}
		</div>

		<figcaption class="mt-1.5 flex justify-between font-mono text-[10px] text-ink-muted">
			{#each tickIdx as i (i)}
				<span>{rows[i] ? tick(rows[i]!.date) : ''}</span>
			{/each}
		</figcaption>
	{/if}
</figure>
