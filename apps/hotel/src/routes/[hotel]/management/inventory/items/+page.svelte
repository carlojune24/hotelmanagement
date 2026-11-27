<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import { BASE_UNIT_LABELS, UNITS, formatQty, type StockBaseUnit } from '$lib/stock-units';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Item = PageData['items'][number];
	const DEPTS = { dining: 'Dining', front_desk: 'Front desk', housekeeping: 'Housekeeping' } as const;
	type Dept = keyof typeof DEPTS;

	let sheet = $state<{ open: boolean; item: Item | null }>({ open: false, item: null });
	let department = $state<Dept>('dining');
	let kind = $state<'consumable' | 'reusable'>('consumable');
	let unit = $state<StockBaseUnit>('pcs');
	let reorderUnit = $state('pcs');
	let busy = $state(false);

	function open(item: Item | null) {
		department = item?.department ?? 'dining';
		kind = item?.kind ?? 'consumable';
		unit = item?.unit ?? 'pcs';
		reorderUnit = unit;
		sheet = { open: true, item };
	}
	// A new unit resets the reorder unit to it, so a kg level is never read as pcs.
	function pickUnit(u: string) {
		unit = u as StockBaseUnit;
		reorderUnit = u;
	}

	const groups = $derived(
		(Object.keys(DEPTS) as Dept[]).map((d) => ({ key: d, label: DEPTS[d], rows: data.items.filter((i) => i.department === d) })).filter((g) => g.rows.length)
	);
	const unitLocked = $derived(!!sheet.item?.hasMoves);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<svelte:head><title>Items · Inventory</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="flex max-w-4xl flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="text-base font-semibold text-ink">Stock items</h2>
			<p class="mt-1 text-sm text-ink-muted">What you keep in stock, which department uses it, and how it is measured.</p>
		</div>
		<Button class="h-11" onclick={() => open(null)}><PlusIcon class="size-4" />Add item</Button>
	</div>

	{#each groups as g (g.key)}
		<section class="mt-6 max-w-4xl" aria-labelledby="items-{g.key}">
			<h3 id="items-{g.key}" class="border-b border-border pb-2 text-sm font-semibold tracking-wide text-ink uppercase">
				{g.label}<span class="ml-1 font-normal tabular-nums text-ink-muted">{g.rows.length}</span>
			</h3>
			<ul class="divide-y divide-border">
				{#each g.rows as i (i.id)}
					<li class="flex items-center gap-3 py-2.5">
						<div class="min-w-0 flex-1">
							<p class="truncate text-base {i.isActive ? 'text-ink' : 'text-ink-muted'}">
								{i.name}{#if !i.isActive}<span class="ml-1 text-xs">inactive</span>{/if}
							</p>
							<p class="text-xs text-ink-muted">
								{i.kind === 'reusable' ? 'Reusable — counted, never used up' : 'Consumable'} · in {i.unit}
								{#if i.reorderLevelMilli != null}· reorder at {formatQty(i.reorderLevelMilli, i.unit)}{/if}
							</p>
						</div>
						<Button variant="ghost" class="h-11 gap-1.5" onclick={() => open(i)} aria-label="Edit {i.name}">
							<PencilIcon class="size-4" aria-hidden="true" /><span class="hidden sm:inline">Edit</span>
						</Button>
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<div class="mt-8 max-w-4xl rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
			<p class="font-medium text-ink">No items yet.</p>
			<p class="mt-1">Start with what runs out: rice, cooking oil, bath soap, shampoo. Linens go in as reusable.</p>
		</div>
	{/each}
</div>

<Sheet.Root bind:open={sheet.open}>
	<Sheet.Content side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
		{@const item = sheet.item}
		<Sheet.Header class="border-b border-border px-5 py-4">
			<Sheet.Title>{item ? `Edit ${item.name}` : 'New stock item'}</Sheet.Title>
			<Sheet.Description>No prices here — stock counts only.</Sheet.Description>
		</Sheet.Header>
		<form
			method="POST"
			action="?/save"
			class="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
			use:enhance={() => {
				busy = true;
				return async ({ result, update }) => {
					busy = false;
					if (result.type === 'success') sheet.open = false;
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="itemId" value={item?.id ?? ''} />
			<input type="hidden" name="department" value={department} />
			<input type="hidden" name="kind" value={kind} />
			<input type="hidden" name="unit" value={unit} />
			<input type="hidden" name="reorderUnit" value={reorderUnit} />

			<div>
				<Label for="name">Name</Label>
				<Input id="name" name="name" required maxlength={120} value={item?.name ?? ''} placeholder="Jasmine rice" class="mt-1 h-11" />
			</div>

			<div>
				<Label for="department">Used by</Label>
				<Select.Root type="single" value={department} onValueChange={(v) => (department = v as Dept)}>
					<Select.Trigger id="department" class="mt-1 h-11 w-full">{DEPTS[department]}</Select.Trigger>
					<Select.Content>
						{#each Object.entries(DEPTS) as [k, label] (k)}<Select.Item value={k} {label} />{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<fieldset>
				<legend class="text-sm font-medium text-ink">Kind</legend>
				<div class="mt-1 inline-flex rounded-md border border-border p-0.5 text-sm" role="radiogroup" aria-label="Kind">
					<button type="button" role="radio" aria-checked={kind === 'consumable'} class="rounded px-3 py-1.5 {kind === 'consumable' ? 'bg-surface-2 font-medium text-ink' : 'text-ink-muted'}" onclick={() => (kind = 'consumable')}>Used up</button>
					<button type="button" role="radio" aria-checked={kind === 'reusable'} class="rounded px-3 py-1.5 {kind === 'reusable' ? 'bg-surface-2 font-medium text-ink' : 'text-ink-muted'}" onclick={() => (kind = 'reusable')}>Reusable</button>
				</div>
				<p class="mt-1 text-xs text-ink-muted">
					{kind === 'reusable' ? 'Towels, bed sheets, curtains: counted and audited, never deducted by orders or check-ins.' : 'Rice, soap, shampoo: taken from stock as it is used.'}
				</p>
			</fieldset>

			<div>
				<Label for="unit">Measured by</Label>
				<Select.Root type="single" value={unit} onValueChange={pickUnit} disabled={unitLocked}>
					<Select.Trigger id="unit" class="mt-1 h-11 w-full">{BASE_UNIT_LABELS[unit]}</Select.Trigger>
					<Select.Content>
						{#each Object.entries(BASE_UNIT_LABELS) as [k, label] (k)}<Select.Item value={k} {label} />{/each}
					</Select.Content>
				</Select.Root>
				{#if unitLocked}
					<p class="mt-1 text-xs text-ink-muted">Fixed now that stock has moved. Add a new item to measure it another way.</p>
				{/if}
			</div>

			<div>
				<Label for="reorderQty">Reorder at (optional)</Label>
				<div class="mt-1 flex gap-2">
					<Input
						id="reorderQty"
						name="reorderQty"
						type="number"
						min="0"
						step="any"
						inputmode="decimal"
						value={item?.reorderLevelMilli != null ? item.reorderLevelMilli / 1000 : ''}
						class="h-11 flex-1 tabular-nums"
					/>
					<Select.Root type="single" bind:value={reorderUnit}>
						<Select.Trigger class="h-11 w-24" aria-label="Reorder unit">{UNITS[unit].find((u) => u.key === reorderUnit)?.label ?? reorderUnit}</Select.Trigger>
						<Select.Content>
							{#each UNITS[unit] as u (u.key)}<Select.Item value={u.key} label={u.label} />{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<p class="mt-1 text-xs text-ink-muted">At or below this, the item shows as low.</p>
			</div>

			{#if item}
				<Label class="flex items-center gap-2 text-sm font-normal text-ink">
					<Checkbox name="isActive" value="on" checked={item.isActive} />
					Active (inactive items can't be received and are hidden from recipes)
				</Label>
			{:else}
				<input type="hidden" name="isActive" value="on" />
			{/if}

			<div class="mt-auto flex justify-end gap-2 border-t border-border pt-4">
				<Button type="button" variant="outline" class="h-11" onclick={() => (sheet.open = false)}>Cancel</Button>
				<Button type="submit" class="h-11" disabled={busy}>{item ? 'Save' : 'Add item'}</Button>
			</div>
		</form>
	</Sheet.Content>
</Sheet.Root>
