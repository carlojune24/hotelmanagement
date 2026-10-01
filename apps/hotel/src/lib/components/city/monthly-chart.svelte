<script lang="ts">
	import { monthLabel, niceMax } from '$lib/city/income';

	type Props = {
		months: { month: string; value: number }[];
		/** Caption above the chart; names what is plotted (a single series needs no legend). */
		title: string;
		/** Exact value for tooltip, aria-label and table, e.g. `₱1,234.00` or `1,204`. */
		formatValue: (n: number) => string;
		/** Short value for the y-axis ticks and the peak label. */
		formatAxis: (n: number) => string;
		/** Value of 1 display unit in stored units (centavos → 100) so axis ticks land on clean numbers. */
		unit?: number;
		/** Force the axis maximum (display units) so several charts share one scale. */
		sharedMax?: number;
		/** Small-multiple mode: shorter plot, top tick only, no table toggle. */
		compact?: boolean;
		valueHeader?: string;
	};

	let {
		months,
		title,
		formatValue,
		formatAxis,
		unit = 1,
		sharedMax,
		compact = false,
		valueHeader = 'Value'
	}: Props = $props();

	const PLOT_H = $derived(compact ? 96 : 220);
	const max = $derived(months.reduce((m, x) => Math.max(m, x.value), 0));
	const top = $derived(niceMax((sharedMax ?? max) / unit) * unit);
	const ticks = $derived(compact ? [0, top] : [0, top / 2, top]);
	// With many months, label every nth so x labels never collide.
	const labelEvery = $derived(months.length > 24 ? 6 : months.length > 12 ? 2 : 1);
	const maxIndex = $derived(max > 0 ? months.findIndex((m) => m.value === max) : -1);

	/** `Sep ’26` — compact x-axis label. */
	const shortMonth = (m: string) => {
		const [y, mo] = m.split('-').map(Number) as [number, number];
		const name = new Intl.DateTimeFormat('en-PH', { month: 'short', timeZone: 'UTC' }).format(
			new Date(Date.UTC(y, mo - 1, 1))
		);
		return `${name} ’${String(y).slice(2)}`;
	};

	let active = $state<number | null>(null);
</script>

<figure class="m-0">
	<figcaption class={compact ? 'text-xs font-medium text-ink' : 'text-sm font-medium text-ink'}>
		{title}
	</figcaption>

	<div class="{compact ? 'mt-1.5 gap-1.5' : 'mt-3 gap-2'} flex">
		<!-- Y axis -->
		<div
			class="relative shrink-0 text-right {compact ? 'w-10' : 'w-[5.5rem]'}"
			style="height: {PLOT_H}px"
			aria-hidden="true"
		>
			{#each ticks as t (t)}
				<span
					class="absolute right-0 font-mono text-[11px] tabular-nums text-ink-muted"
					style="bottom: {(t / top) * 100}%; transform: translateY(50%)">{formatAxis(t)}</span
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
						{@const h = (m.value / top) * 100}
						<button
							type="button"
							class="group relative flex flex-1 cursor-default items-end justify-center border-0 bg-transparent p-0 outline-none"
							aria-label="{monthLabel(m.month)}: {formatValue(m.value)}"
							onpointerenter={() => (active = i)}
							onpointerleave={() => (active = null)}
							onfocus={() => (active = i)}
							onblur={() => (active = null)}
						>
							{#if m.value > 0}
								<div
									class="w-full max-w-6 rounded-t-[4px] bg-brand transition-[filter] group-hover:brightness-110 group-focus-visible:brightness-110 group-focus-visible:ring-2 group-focus-visible:ring-ring"
									style="height: {h}%; margin-inline: 1px"
								></div>
								{#if !compact && i === maxIndex}
									<span
										class="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] tabular-nums text-ink"
										style="bottom: calc({h}% + 4px)">{formatAxis(m.value)}</span
									>
								{/if}
							{/if}

							{#if active === i}
								<div
									class="pointer-events-none absolute z-10 w-max -translate-x-1/2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
									style="left: 50%; bottom: calc({h}% + {!compact && i === maxIndex ? 22 : 8}px)"
								>
									<div class="font-mono text-sm font-medium tabular-nums text-ink">
										{formatValue(m.value)}
									</div>
									<div class="text-ink-muted">{monthLabel(m.month)}</div>
								</div>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<!-- X axis labels (compact: first and last month only) -->
			<div class="flex" aria-hidden="true">
				{#each months as m, i (m.month)}
					<div class="flex-1 pt-1.5 text-center text-[11px] text-ink-muted">
						{#if compact}
							{#if i === 0 || i === months.length - 1}<span class="whitespace-nowrap">{shortMonth(m.month)}</span>{/if}
						{:else if i % labelEvery === 0}{shortMonth(m.month)}{/if}
					</div>
				{/each}
			</div>
		</div>
	</div>

	{#if !compact}
		<details class="mt-3 text-sm">
			<summary class="w-fit cursor-pointer text-ink-muted hover:text-ink">View as table</summary>
			<table class="mt-2 w-full max-w-sm text-sm">
				<thead>
					<tr class="border-b border-border text-left text-xs text-ink-muted">
						<th class="py-1.5 font-medium">Month</th>
						<th class="py-1.5 text-right font-medium">{valueHeader}</th>
					</tr>
				</thead>
				<tbody>
					{#each months as m (m.month)}
						<tr class="border-b border-border/60">
							<td class="py-1.5 text-ink">{monthLabel(m.month)}</td>
							<td class="py-1.5 text-right font-mono tabular-nums text-ink">{formatValue(m.value)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</details>
	{/if}
</figure>
