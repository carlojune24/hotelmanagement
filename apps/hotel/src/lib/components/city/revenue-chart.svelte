<script lang="ts">
	import { formatPeso, monthLabel, niceMax } from '$lib/city/income';

	let { months }: { months: { month: string; revenueCentavos: number }[] } = $props();

	const PLOT_H = 220;
	const max = $derived(months.reduce((m, x) => Math.max(m, x.revenueCentavos), 0));
	const top = $derived(niceMax(max / 100) * 100);
	const ticks = $derived([0, top / 2, top]);
	// With many months, label every nth so x labels never collide.
	const labelEvery = $derived(months.length > 24 ? 6 : months.length > 12 ? 2 : 1);
	const maxIndex = $derived(max > 0 ? months.findIndex((m) => m.revenueCentavos === max) : -1);

	/** `Sep ’26` — compact x-axis label. */
	const shortMonth = (m: string) => {
		const [y, mo] = m.split('-').map(Number) as [number, number];
		const name = new Intl.DateTimeFormat('en-PH', { month: 'short', timeZone: 'UTC' }).format(
			new Date(Date.UTC(y, mo - 1, 1))
		);
		return `${name} ’${String(y).slice(2)}`;
	};
	const compact = (centavos: number) =>
		new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(centavos / 100);
	const axisPeso = (centavos: number) => `₱${(centavos / 100).toLocaleString('en-PH')}`;

	let active = $state<number | null>(null);
</script>

<figure class="m-0">
	<figcaption class="text-sm font-medium text-ink">Revenue by month</figcaption>

	<div class="mt-3 flex gap-2">
		<!-- Y axis -->
		<div class="relative w-[5.5rem] shrink-0 text-right" style="height: {PLOT_H}px" aria-hidden="true">
			{#each ticks as t (t)}
				<span
					class="absolute right-0 font-mono text-[11px] tabular-nums text-ink-muted"
					style="bottom: {(t / top) * 100}%; transform: translateY(50%)">{axisPeso(t)}</span
				>
			{/each}
		</div>

		<div class="min-w-0 flex-1">
			<div class="relative" style="height: {PLOT_H}px">
				<!-- recessive gridlines -->
				{#each ticks as t (t)}
					<div
						class="pointer-events-none absolute inset-x-0 border-t border-border"
						style="bottom: {(t / top) * 100}%"
					></div>
				{/each}

				<div class="absolute inset-0 flex">
					{#each months as m, i (m.month)}
						{@const h = (m.revenueCentavos / top) * 100}
						<button
							type="button"
							class="group relative flex flex-1 cursor-default items-end justify-center border-0 bg-transparent p-0 outline-none"
							aria-label="{monthLabel(m.month)}: {formatPeso(m.revenueCentavos)}"
							onpointerenter={() => (active = i)}
							onpointerleave={() => (active = null)}
							onfocus={() => (active = i)}
							onblur={() => (active = null)}
						>
							{#if m.revenueCentavos > 0}
								<div
									class="w-full max-w-6 rounded-t-[4px] bg-brand transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-ring"
									style="height: {h}%; margin-inline: 1px"
								></div>
								{#if i === maxIndex}
									<span
										class="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] tabular-nums text-ink"
										style="bottom: calc({h}% + 4px)">₱{compact(m.revenueCentavos)}</span
									>
								{/if}
							{/if}

							{#if active === i}
								<div
									class="pointer-events-none absolute z-10 w-max -translate-x-1/2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
									style="left: 50%; bottom: calc({h}% + {i === maxIndex ? 22 : 8}px)"
								>
									<div class="font-mono text-sm font-medium tabular-nums text-ink">
										{formatPeso(m.revenueCentavos)}
									</div>
									<div class="text-ink-muted">{monthLabel(m.month)}</div>
								</div>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<!-- X axis labels -->
			<div class="flex" aria-hidden="true">
				{#each months as m, i (m.month)}
					<div class="flex-1 pt-1.5 text-center text-[11px] text-ink-muted">
						{#if i % labelEvery === 0}{shortMonth(m.month)}{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>

	<details class="mt-3 text-sm">
		<summary class="w-fit cursor-pointer text-ink-muted hover:text-ink">View as table</summary>
		<table class="mt-2 w-full max-w-sm text-sm">
			<thead>
				<tr class="border-b border-border text-left text-xs text-ink-muted">
					<th class="py-1.5 font-medium">Month</th>
					<th class="py-1.5 text-right font-medium">Revenue</th>
				</tr>
			</thead>
			<tbody>
				{#each months as m (m.month)}
					<tr class="border-b border-border/60">
						<td class="py-1.5 text-ink">{monthLabel(m.month)}</td>
						<td class="py-1.5 text-right font-mono tabular-nums text-ink"
							>{formatPeso(m.revenueCentavos)}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</details>
</figure>
