<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import { UNITS, toMilli, type StockBaseUnit } from '$lib/stock-units';

	/**
	 * A list of stock items × quantity, saved on its own form. Used for a dish's or add-on's
	 * ingredients and, with `withPer`, a room type's check-in amenity kit (each line per room or per guest).
	 */
	interface Choice {
		id: string;
		name: string;
		unit: StockBaseUnit;
	}
	type Per = 'room' | 'guest';

	let {
		action = '?/saveRecipe',
		hidden,
		lines,
		choices,
		title = 'Ingredients',
		hint,
		withPer = false,
		saveLabel = 'Save ingredients',
		emptyChoices = 'No stock items yet.',
		inventoryHref
	}: {
		action?: string;
		/** Extra hidden fields naming what this list belongs to. */
		hidden: Record<string, string>;
		lines: { stockItemId: string; qtyMilli: number; per?: Per }[];
		choices: Choice[];
		title?: string;
		hint: string;
		withPer?: boolean;
		saveLabel?: string;
		emptyChoices?: string;
		inventoryHref: string;
	} = $props();

	type Row = { stockItemId: string; qty: string; unit: string; per: Per };
	const byId = (id: string) => choices.find((c) => c.id === id);
	// Seeded once from the saved list; the parent remounts this per dish / room type.
	let rows = $state<Row[]>(
		// svelte-ignore state_referenced_locally
		lines.map((l) => ({ stockItemId: l.stockItemId, qty: String(l.qtyMilli / 1000), unit: byId(l.stockItemId)?.unit ?? 'pcs', per: l.per ?? 'room' }))
	);

	const payload = $derived(
		JSON.stringify(
			rows.flatMap((r) => {
				const c = byId(r.stockItemId);
				const milli = c ? toMilli(Number(r.qty), r.unit, c.unit) : null;
				if (!c || !milli || milli <= 0) return [];
				return [withPer ? { stockItemId: c.id, qtyMilli: milli, per: r.per } : { stockItemId: c.id, qtyMilli: milli }];
			})
		)
	);
	const incomplete = $derived(rows.some((r) => !r.stockItemId || !(Number(r.qty) > 0)));
	const taken = $derived(new Set(rows.map((r) => r.stockItemId)));
	const uid = $props.id();

	function pick(row: Row, id: string) {
		row.stockItemId = id;
		row.unit = byId(id)?.unit ?? 'pcs';
	}
</script>

<section class="space-y-2 border-t border-border pt-4" aria-labelledby="{uid}-title">
	<div>
		<h3 id="{uid}-title" class="text-sm font-medium text-ink">{title}</h3>
		<p class="text-xs text-ink-muted">{hint}</p>
	</div>

	{#if choices.length === 0}
		<p class="text-sm text-ink-muted">
			{emptyChoices} <a class="underline" href={inventoryHref}>Add them in Inventory</a> first.
		</p>
	{:else}
		<form method="POST" {action} use:enhance={() => async ({ update }) => update({ reset: false })} class="space-y-2">
			{#each Object.entries(hidden) as [name, value] (name)}<input type="hidden" {name} {value} />{/each}
			<input type="hidden" name="lines" value={payload} />
			{#each rows as row, i (i)}
				{@const c = byId(row.stockItemId)}
				<div class="flex flex-wrap items-center gap-2">
					<Select.Root type="single" value={row.stockItemId} onValueChange={(v) => pick(row, v)}>
						<Select.Trigger class="min-w-0 flex-1 basis-40" aria-label="Item {i + 1}">
							<span class="truncate">{c?.name ?? 'Choose an item'}</span>
						</Select.Trigger>
						<Select.Content>
							{#each choices as ch (ch.id)}
								<Select.Item value={ch.id} label={ch.name} disabled={taken.has(ch.id) && ch.id !== row.stockItemId} />
							{/each}
						</Select.Content>
					</Select.Root>
					<Input bind:value={row.qty} type="number" min="0" step="any" inputmode="decimal" class="w-20 tabular-nums" aria-label="Quantity of item {i + 1}" />
					<Select.Root type="single" bind:value={row.unit} disabled={!c}>
						<Select.Trigger class="w-20" aria-label="Unit of item {i + 1}">
							{UNITS[c?.unit ?? 'pcs'].find((u) => u.key === row.unit)?.label ?? row.unit}
						</Select.Trigger>
						<Select.Content>
							{#each UNITS[c?.unit ?? 'pcs'] as u (u.key)}
								<Select.Item value={u.key} label={u.label} />
							{/each}
						</Select.Content>
					</Select.Root>
					{#if withPer}
						<div class="inline-flex rounded-md border border-border p-0.5 text-xs" role="radiogroup" aria-label="Item {i + 1} counted per">
							{#each ['room', 'guest'] as const as p (p)}
								<button
									type="button"
									role="radio"
									aria-checked={row.per === p}
									class="rounded px-2 py-1 {row.per === p ? 'bg-surface-2 font-medium text-ink' : 'text-ink-muted'}"
									onclick={() => (row.per = p)}>per {p}</button
								>
							{/each}
						</div>
					{/if}
					<Button type="button" variant="ghost" size="icon" aria-label="Remove item {i + 1}" onclick={() => rows.splice(i, 1)}>
						<XIcon class="size-4" />
					</Button>
				</div>
			{/each}
			<div class="flex items-center justify-between gap-2">
				<Button type="button" variant="ghost" size="sm" class="px-2" onclick={() => rows.push({ stockItemId: '', qty: '', unit: 'pcs', per: 'room' })}>
					<PlusIcon class="size-4" /> Add item
				</Button>
				<Button type="submit" variant="outline" size="sm" disabled={incomplete}>{saveLabel}</Button>
			</div>
		</form>
	{/if}
</section>
