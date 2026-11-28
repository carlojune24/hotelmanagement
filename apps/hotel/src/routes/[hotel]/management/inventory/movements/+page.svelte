<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import { formatQty } from '$lib/stock-units';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Move = PageData['movements'][number];
	type Kind = Move['type'];
	const LABEL: Record<Kind, string> = {
		restock: 'Received',
		adjust_in: 'Count up',
		waste: 'Waste',
		adjust_out: 'Count down',
		order: 'Dining order',
		order_reverse: 'Order cancelled',
		checkin_kit: 'Check-in amenities',
		restock_void: 'Receipt voided'
	};
	const FILTERS: { key: string; label: string; types: Kind[] }[] = [
		{ key: '', label: 'All', types: [] },
		{ key: 'in', label: 'Received', types: ['restock', 'restock_void'] },
		{ key: 'orders', label: 'Orders', types: ['order', 'order_reverse'] },
		{ key: 'checkins', label: 'Check-ins', types: ['checkin_kit'] },
		{ key: 'waste', label: 'Waste', types: ['waste'] },
		{ key: 'count', label: 'Corrections', types: ['adjust_in', 'adjust_out'] }
	];
	let kind = $state('');
	const shown = $derived.by(() => {
		const f = FILTERS.find((x) => x.key === kind)!;
		return f.types.length ? data.movements.filter((m) => f.types.includes(m.type)) : data.movements;
	});

	const when = $derived(
		new Intl.DateTimeFormat('en-PH', { timeZone: data.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
	);
	const dateFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

	const picked = $derived(data.items.find((i) => i.id === data.itemId));
	const itemLabel = $derived(picked?.name ?? 'All items');
	const kindLabel = $derived(FILTERS.find((f) => f.key === kind)?.label ?? 'All');
	const printedAt = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
	function pickItem(id: string) {
		const url = new URL(page.url);
		if (id) url.searchParams.set('item', id);
		else url.searchParams.delete('item');
		goto(url, { keepFocus: true, noScroll: true });
	}
</script>

<svelte:head><title>Movements · Inventory</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="max-w-5xl">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 class="text-base font-semibold text-ink">Stock movements{picked ? `: ${picked.name}` : ''}</h2>
				<p class="mt-1 text-sm text-ink-muted print:hidden">Every change to stock, newest first, with what was left after each one.</p>
				<!-- On paper the filters are gone, so say what this list is. -->
				<p class="mt-1 hidden text-sm text-ink print:block">
					{itemLabel} · {kindLabel}{picked ? ` · on hand ${formatQty(picked.onHandMilli, picked.unit)}` : ''} · printed {printedAt.format(new Date())}
				</p>
			</div>
			{#if shown.length}
				<Button variant="outline" size="sm" class="print:hidden" onclick={() => window.print()}><PrinterIcon class="size-4" />Print</Button>
			{/if}
		</div>

		<div class="mt-4 flex flex-wrap items-center gap-3 print:hidden">
			<Select.Root type="single" value={data.itemId ?? ''} onValueChange={pickItem}>
				<Select.Trigger class="w-56" aria-label="Item">{itemLabel}</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="All items" />
					{#each data.items as i (i.id)}<Select.Item value={i.id} label={i.name} />{/each}
				</Select.Content>
			</Select.Root>
			{#if picked}
				<p class="text-sm text-ink-muted">
					On hand now: <span class="font-semibold tabular-nums {picked.onHandMilli < 0 ? 'text-danger' : 'text-ink'}">{formatQty(picked.onHandMilli, picked.unit)}</span>
				</p>
			{/if}
			<ToggleGroup.Root
				type="single"
				variant="outline"
				value={kind || 'all'}
				onValueChange={(v) => v && (kind = v === 'all' ? '' : v)}
				aria-label="Kind of movement"
				class="flex-wrap"
			>
				{#each FILTERS as f (f.key)}
					<ToggleGroup.Item value={f.key || 'all'} class="px-3">{f.label}</ToggleGroup.Item>
				{/each}
			</ToggleGroup.Root>
		</div>

		{#if shown.length}
			<ul class="mt-6 divide-y divide-border border-t border-border">
				{#each shown as m (m.id)}
					<li class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[8.5rem_1fr_auto]">
						<span class="text-sm tabular-nums text-ink-muted sm:row-span-2">{when.format(new Date(m.createdAt))}</span>
						<p class="col-start-1 min-w-0 truncate text-sm text-ink sm:col-start-2">
							<span class="font-medium">{m.itemName}</span>
							<span class="text-ink-muted">· {LABEL[m.type]}</span>
						</p>
						<div class="row-span-2 self-center text-right sm:col-start-3 sm:row-start-1">
							<p class="text-base font-medium tabular-nums {m.qtyMilli < 0 ? 'text-ink' : 'text-brand'}">
								{m.qtyMilli > 0 ? '+' : ''}{formatQty(m.qtyMilli, m.unit)}
							</p>
							<p class="text-xs tabular-nums {Number(m.balanceMilli) < 0 ? 'text-danger' : 'text-ink-muted'}">
								{formatQty(Number(m.balanceMilli), m.unit)} left
							</p>
						</div>
						<p class="col-start-1 min-w-0 text-xs text-ink-muted sm:col-start-2">
							{[
								m.note,
								m.qtyRemainingMilli != null && m.qtyMilli > 0 ? `${formatQty(m.qtyRemainingMilli, m.unit)} of it left` : null,
								m.packCount ? `${m.packCount}${m.packBonus ? ` + ${m.packBonus} free` : ''} × ${formatQty(m.packSizeMilli ?? 0, m.unit)}` : null,
								m.expiresOn ? `expires ${dateFmt.format(new Date(`${m.expiresOn}T00:00:00Z`))}` : null,
								m.type !== 'order' && m.type !== 'order_reverse' ? (m.byName ?? null) : null
							]
								.filter(Boolean)
								.join(' · ')}
						</p>
					</li>
				{/each}
			</ul>
			{#if data.movements.length >= 300}
				<p class="mt-3 text-xs text-ink-muted">Showing the newest 300. Pick an item to narrow it down.</p>
			{/if}
		{:else}
			<p class="mt-8 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
				{data.movements.length ? 'Nothing of that kind.' : 'No stock has moved yet.'}
			</p>
		{/if}
	</div>
</div>
