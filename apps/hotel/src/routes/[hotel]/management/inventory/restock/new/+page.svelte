<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import VendorCombobox from '$lib/components/staff/vendor-combobox.svelte';
	import { UNITS, formatQty, toMilli } from '$lib/stock-units';
	import { vatPortion } from '$lib/dining-orders';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const back = $derived(`/${page.params.hotel}/management/inventory/restock`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	type Item = PageData['items'][number];
	const byId = (id: string): Item | undefined => data.items.find((i) => i.id === id);

	// Own state, seeded once: the staff layout refreshes `data` every 30 s, which must not wipe a half-typed receipt.
	// svelte-ignore state_referenced_locally
	let receiptDate = $state(data.today);
	let vendor = $state('');
	type Row = { itemId: string; qty: string; unit: string; expiresOn: string };
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>([{ itemId: data.preset ?? '', qty: '', unit: byId(data.preset ?? '')?.unit ?? 'pcs', expiresOn: '' }]);
	let total = $state<number | null>(null);
	let isVatable = $state(false);
	let busy = $state(false);

	// Category and source follow the items until someone picks them by hand.
	let categoryId = $state('');
	let source = $state<'hotel' | 'dining'>('hotel');
	let pickedByHand = $state(false);
	const allDining = $derived(rows.some((r) => r.itemId) && rows.filter((r) => r.itemId).every((r) => byId(r.itemId)?.department === 'dining'));
	const suggested = $derived(
		data.categories.find((c) => c.name.toLowerCase() === (allDining ? 'food & beverage cost' : 'housekeeping supplies'))?.id ?? data.categories[0]?.id ?? ''
	);
	$effect(() => {
		if (pickedByHand) return;
		categoryId = suggested;
		source = allDining ? 'dining' : 'hotel';
	});
	const categoryName = $derived(data.categories.find((c) => c.id === categoryId)?.name ?? 'Pick a category');

	function pick(row: Row, id: string) {
		row.itemId = id;
		row.unit = byId(id)?.unit ?? 'pcs';
	}
	const taken = $derived(new Set(rows.map((r) => r.itemId)));
	const valid = $derived(rows.filter((r) => r.itemId && Number(r.qty) > 0));
	const incomplete = $derived(rows.some((r) => !r.itemId || !(Number(r.qty) > 0)));
	const totalC = $derived(Math.round((total ?? 0) * 100));
	const vatC = $derived(isVatable ? vatPortion(totalC, data.vatRateBps) : 0);
	const payload = $derived(JSON.stringify(valid.map((r) => ({ itemId: r.itemId, qty: Number(r.qty), unit: r.unit, expiresOn: r.expiresOn }))));

	$effect(() => {
		if (form?.error) toast.error(form.error);
	});
</script>

<svelte:head><title>New restock · Inventory</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<form
		method="POST"
		enctype="multipart/form-data"
		class="max-w-4xl"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				busy = false;
				await update({ reset: false });
			};
		}}
	>
		<a href={back} class="text-sm text-ink-muted hover:text-ink">← All receipts</a>
		<h2 class="mt-2 text-base font-semibold text-ink">New restock</h2>
		<p class="mt-1 text-sm text-ink-muted">Copy the supplier's receipt in. The items go into stock and the total becomes one expense for Finance to pay.</p>

		<section class="mt-6" aria-labelledby="rs-receipt">
			<h3 id="rs-receipt" class="border-b border-border pb-2 text-sm font-semibold tracking-wide text-ink uppercase">Receipt</h3>
			<div class="mt-3 grid gap-3 sm:grid-cols-3">
				<div>
					<Label for="receiptDate">Date on the receipt</Label>
					<Input id="receiptDate" name="receiptDate" type="date" bind:value={receiptDate} required class="mt-1 h-11" />
				</div>
				<div>
					<Label for="rs-vendor">Supplier</Label>
					<VendorCombobox vendors={data.vendors} bind:value={vendor} id="rs-vendor" />
				</div>
				<div>
					<Label for="receiptNo">OR / invoice / DR no.</Label>
					<Input id="receiptNo" name="receiptNo" maxlength={120} class="mt-1 h-11" />
				</div>
			</div>
		</section>

		<section class="mt-6" aria-labelledby="rs-items">
			<h3 id="rs-items" class="border-b border-border pb-2 text-sm font-semibold tracking-wide text-ink uppercase">
				Items on the receipt<span class="ml-1 font-normal tabular-nums text-ink-muted">{valid.length}</span>
			</h3>
			{#if data.items.length === 0}
				<p class="mt-3 text-sm text-ink-muted">
					No stock items yet. {#if data.inventory.canManage}<a class="underline" href="/{page.params.hotel}/management/inventory/items">Add them in Items</a> first.{:else}Ask a hotel admin to add them.{/if}
				</p>
			{:else}
				<input type="hidden" name="lines" value={payload} />
				<ul class="divide-y divide-border">
					{#each rows as row, i (i)}
						{@const it = byId(row.itemId)}
						<li class="flex flex-wrap items-end gap-2 py-3">
							<div class="min-w-48 flex-1">
								<Label class="text-xs text-ink-muted">Item</Label>
								<Select.Root type="single" value={row.itemId} onValueChange={(v) => pick(row, v)}>
									<Select.Trigger class="mt-1 h-11 w-full min-w-0" aria-label="Item {i + 1}">
										<span class="truncate">{it?.name ?? 'Choose an item'}</span>
									</Select.Trigger>
									<Select.Content>
										{#each data.items as o (o.id)}
											<Select.Item value={o.id} label={o.name} disabled={taken.has(o.id) && o.id !== row.itemId} />
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div>
								<Label class="text-xs text-ink-muted">Quantity</Label>
								<div class="mt-1 flex gap-1.5">
									<Input bind:value={row.qty} type="number" min="0" step="any" inputmode="decimal" class="h-11 w-24 tabular-nums" aria-label="Quantity of item {i + 1}" />
									<Select.Root type="single" bind:value={row.unit} disabled={!it}>
										<Select.Trigger class="h-11 w-20" aria-label="Unit of item {i + 1}">
											{UNITS[it?.unit ?? 'pcs'].find((u) => u.key === row.unit)?.label ?? row.unit}
										</Select.Trigger>
										<Select.Content>
											{#each UNITS[it?.unit ?? 'pcs'] as u (u.key)}<Select.Item value={u.key} label={u.label} />{/each}
										</Select.Content>
									</Select.Root>
								</div>
							</div>
							<div>
								<Label class="text-xs text-ink-muted">Expiry (optional)</Label>
								<Input bind:value={row.expiresOn} type="date" class="mt-1 h-11 w-40" aria-label="Expiry of item {i + 1}" />
							</div>
							<Button type="button" variant="ghost" size="icon" class="size-11" aria-label="Remove item {i + 1}" disabled={rows.length === 1} onclick={() => rows.splice(i, 1)}>
								<XIcon class="size-4" />
							</Button>
							{#if it && Number(row.qty) > 0}
								{@const m = toMilli(Number(row.qty), row.unit, it.unit)}
								{#if m && row.unit !== it.unit}<p class="w-full text-xs text-ink-muted">= {formatQty(m, it.unit)}</p>{/if}
							{/if}
						</li>
					{/each}
				</ul>
				<Button type="button" variant="ghost" size="sm" class="mt-1 px-2" onclick={() => rows.push({ itemId: '', qty: '', unit: 'pcs', expiresOn: '' })}>
					<PlusIcon class="size-4" /> Add another item
				</Button>
			{/if}
		</section>

		<section class="mt-6" aria-labelledby="rs-amount">
			<h3 id="rs-amount" class="border-b border-border pb-2 text-sm font-semibold tracking-wide text-ink uppercase">Amount and expense</h3>
			<div class="mt-3 grid gap-3 sm:grid-cols-3">
				<div>
					<Label for="total">Receipt total (₱)</Label>
					<Input id="total" name="total" type="number" min="0.01" step="0.01" inputmode="decimal" required bind:value={total} class="mt-1 h-11 tabular-nums" />
					<p class="mt-1 text-xs text-ink-muted">The total you pay the supplier.</p>
				</div>
				<div>
					<Label for="category">Expense category</Label>
					<input type="hidden" name="categoryId" value={categoryId} />
					<Select.Root type="single" value={categoryId} onValueChange={(v) => ((categoryId = v), (pickedByHand = true))}>
						<Select.Trigger id="category" class="mt-1 h-11 w-full">{categoryName}</Select.Trigger>
						<Select.Content>
							{#each data.categories as c (c.id)}<Select.Item value={c.id} label={c.name} />{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<fieldset>
					<legend class="text-sm font-medium text-ink">For</legend>
					<input type="hidden" name="source" value={source} />
					<div class="mt-1 inline-flex rounded-md border border-border p-0.5 text-sm" role="radiogroup" aria-label="Expense for">
						{#each [['hotel', 'Hotel'], ['dining', 'Dining']] as const as [v, label] (v)}
							<button
								type="button"
								role="radio"
								aria-checked={source === v}
								class="h-10 rounded px-4 {source === v ? 'bg-surface-2 font-medium text-ink' : 'text-ink-muted hover:text-ink'}"
								onclick={() => ((source = v), (pickedByHand = true))}>{label}</button
							>
						{/each}
					</div>
				</fieldset>
			</div>
			<label class="mt-3 flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="isVatable" bind:checked={isVatable} class="size-4" /> Receipt includes {data.vatRateBps / 100}% VAT
			</label>
			{#if totalC > 0 && isVatable}
				<p class="mt-1 text-xs text-ink-muted">Input VAT <span class="tabular-nums">{peso(vatC)}</span> · Net of VAT <span class="tabular-nums">{peso(totalC - vatC)}</span></p>
			{/if}
		</section>

		<section class="mt-6 grid gap-3 sm:grid-cols-2" aria-label="Receipt photo and note">
			<div>
				<Label for="attachment">Receipt photo</Label>
				<Input id="attachment" name="attachment" type="file" accept="image/*" capture="environment" class="mt-1" />
				<p class="mt-1 text-xs text-ink-muted">Attached to the expense too, for Finance.</p>
			</div>
			<div>
				<Label for="note">Note (optional)</Label>
				<Textarea id="note" name="note" rows={2} maxlength={500} class="mt-1" />
			</div>
		</section>

		<div class="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-surface py-3">
			<p class="flex-1 text-sm text-ink-muted" aria-live="polite">
				{#if valid.length && totalC > 0}
					Adds {valid.length} item{valid.length === 1 ? '' : 's'} to stock · creates a <span class="tabular-nums text-ink">{peso(totalC)}</span> expense for Finance
				{:else}
					Add the items and the total to save.
				{/if}
			</p>
			<Button type="button" variant="outline" class="h-11" href={back}>Cancel</Button>
			<Button type="submit" class="h-11" disabled={busy || incomplete || totalC <= 0 || !categoryId}>Save receipt</Button>
		</div>
	</form>
</div>
