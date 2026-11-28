<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import PackagePlusIcon from '@lucide/svelte/icons/package-plus';
	import { formatQty } from '$lib/stock-units';
	import { DEFAULT_LEAD_DAYS, daysLeftLabel } from '$lib/stock-forecast';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Row = PageData['toOrder'][number];
	const base = $derived(`/${page.params.hotel}/management/inventory`);
	const dateFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
	const fmtDate = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));

	// One group per usual supplier (the last restock's); items never restocked go last.
	const groups = $derived.by(() => {
		const by = new Map<string, Row[]>();
		for (const r of data.toOrder) by.set(r.usualSupplier ?? '', [...(by.get(r.usualSupplier ?? '') ?? []), r]);
		return [...by.entries()]
			.sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
			.map(([supplier, rows]) => ({ supplier, rows: rows.sort((x, y) => (x.daysLeft ?? 0) - (y.daysLeft ?? 0)) }));
	});

	function why(r: Row): string {
		const lead = r.leadTimeDays ?? DEFAULT_LEAD_DAYS;
		if (r.reason === 'out') return 'Out of stock';
		if (r.reason === 'runs_out') return `${daysLeftLabel(r.daysLeft)} · runs out ${fmtDate(r.runOutDate!)} · supplier needs ${lead} day${lead === 1 ? '' : 's'}`;
		return 'At or below its reorder level';
	}
	const restockHref = (rows: Row[]) => `${base}/restock/new?${rows.map((r) => `item=${r.id}`).join('&')}`;
</script>

<svelte:head><title>Shopping list · Inventory</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="max-w-4xl">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h2 class="text-base font-semibold text-ink">Shopping list</h2>
				<p class="mt-1 text-sm text-ink-muted">
					What to order now, from the last 4 weeks of use and each supplier's lead time. Quantities are a suggestion; buy what makes sense.
				</p>
				<p class="mt-1 hidden text-sm text-ink print:block">As of {fmtDate(data.today)}</p>
			</div>
			{#if data.toOrder.length}
				<Button variant="outline" class="print:hidden" onclick={() => window.print()}><PrinterIcon class="size-4" />Print</Button>
			{/if}
		</div>

		{#each groups as g (g.supplier)}
			<section class="mt-6 break-inside-avoid" aria-labelledby="sl-{g.supplier || 'none'}">
				<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
					<h3 id="sl-{g.supplier || 'none'}" class="text-sm font-semibold tracking-wide text-ink uppercase">
						{g.supplier || 'No supplier yet'}<span class="ml-1 font-normal tabular-nums text-ink-muted">{g.rows.length}</span>
					</h3>
					{#if data.inventory.canWrite}
						<Button variant="ghost" size="sm" class="h-9 gap-1.5 print:hidden" href={restockHref(g.rows)}>
							<PackagePlusIcon class="size-4" aria-hidden="true" />Restock these
						</Button>
					{/if}
				</div>
				<ul class="divide-y divide-border">
					{#each g.rows as r (r.id)}
						<li class="flex items-center gap-3 py-2.5">
							<div class="min-w-0 flex-1">
								<p class="truncate text-base text-ink">{r.name}</p>
								<p class="text-xs {r.reason ==='out' ? 'text-danger' : 'text-ink-muted'}">{why(r)}</p>
							</div>
							<div class="text-right">
								<p class="text-base font-medium tabular-nums text-ink">
									{r.suggestedMilli != null ? formatQty(r.suggestedMilli, r.unit) : '—'}
								</p>
								<p class="text-xs tabular-nums text-ink-muted">
									{r.suggestedMilli != null ? 'suggested' : 'no usage yet'} · have {formatQty(r.onHandMilli, r.unit)}
								</p>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<p class="mt-6 flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink">
				<CheckIcon class="size-4 text-brand" aria-hidden="true" />Nothing to order. Everything lasts beyond its supplier's lead time.
			</p>
		{/each}
	</div>
</div>
