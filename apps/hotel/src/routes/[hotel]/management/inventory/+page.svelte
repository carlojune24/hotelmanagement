<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CheckIcon from '@lucide/svelte/icons/check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import PackagePlusIcon from '@lucide/svelte/icons/package-plus';
	import { UNITS, formatQty, toMilli } from '$lib/stock-units';
	import { daysLeftLabel } from '$lib/stock-forecast';
	import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Row = PageData['stock'][number];
	type Dept = Row['department'];
	const DEPTS: { key: Dept; label: string }[] = [
		{ key: 'dining', label: 'Dining' },
		{ key: 'hotel', label: 'Hotel' }
	];

	let dept = $state<Dept | ''>('');
	let query = $state('');
	let lowOnly = $state(false);
	let showInactive = $state(false);

	const active = $derived(data.stock.filter((r) => r.isActive));
	const negative = $derived(active.filter((r) => r.onHandMilli < 0));
	const low = $derived(active.filter((r) => r.isLow && r.onHandMilli >= 0));
	const inactiveCount = $derived(data.stock.length - active.length);
	const toOrder = $derived(active.filter((r) => data.ahead[r.id]?.needsOrder));
	const leftOf = (id: string) => daysLeftLabel(data.ahead[id]?.daysLeft ?? null);
	const shown = $derived(
		data.stock.filter(
			(r) =>
				(showInactive || r.isActive) &&
				(dept === '' || r.department === dept) &&
				(!lowOnly || r.isLow || r.onHandMilli < 0) &&
				(query.trim() === '' || r.name.toLowerCase().includes(query.trim().toLowerCase()))
		)
	);
	const groups = $derived(DEPTS.map((d) => ({ ...d, rows: shown.filter((r) => r.department === d.key) })).filter((g) => g.rows.length));

	const dateFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
	const fmtDate = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));

	// ---- the one side sheet: waste / correct count (stock comes in through Restock, with its receipt) ----
	type Mode = 'remove' | 'count';
	let sheet = $state<{ open: boolean; mode: Mode; item: Row | null }>({ open: false, mode: 'remove', item: null });
	let qty = $state('');
	let unit = $state('pcs');
	let busy = $state(false);

	function open(mode: Mode, item: Row) {
		qty = '';
		unit = item.unit;
		sheet = { open: true, mode, item };
	}

	const item = $derived(sheet.item);
	const units = $derived(item ? UNITS[item.unit] : []);
	const unitLabel = $derived(units.find((u) => u.key === unit)?.label ?? unit);
	/** What the form would move, in thousandths of the base unit, for the live preview. */
	// bind:value on a number input yields a number, or null once cleared — never count an empty box as 0.
	const entered = $derived(!item || qty === '' || qty == null ? null : toMilli(Number(qty), unit, item.unit));
	const after = $derived(!item || entered == null ? null : sheet.mode === 'remove' ? item.onHandMilli - entered : entered);

	const TITLES: Record<Mode, string> = { remove: 'Record waste', count: 'Correct count' };

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<svelte:head><title>Stock · Inventory</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="max-w-4xl">
		<h2 class="text-base font-semibold text-ink">Stock on hand</h2>
		<p class="mt-1 text-sm text-ink-muted">
			Oldest delivery is used first. Dining orders take their ingredients automatically once they reach the kitchen.
		</p>

		{#if active.length > 0}
			<div
				class="mt-4 rounded-lg border px-4 py-3 {negative.length || low.length ?'border-warning/60 bg-warning/10' : 'border-border bg-surface'}"
				aria-live="polite"
			>
				{#if !negative.length && !low.length}
					<p class="flex items-center gap-2 text-sm text-ink"><CheckIcon class="size-4 text-brand" aria-hidden="true" />All stocked.</p>
				{:else}
					<p class="flex items-center gap-2 text-sm font-semibold text-ink">
						<TriangleAlertIcon class="size-4" aria-hidden="true" />
						{[low.length && `${low.length} low`, negative.length && `${negative.length} below zero`].filter(Boolean).join(' · ')}
					</p>
					<p class="mt-1 text-sm text-ink-muted">{[...negative, ...low].map((r) => r.name).join(' · ')}</p>
					{#if negative.length}
						<p class="mt-1 text-xs text-ink-muted">Below zero means more was used than was received. Encode the delivery in Restock or correct the count.</p>
					{/if}
				{/if}
			</div>
			{#if toOrder.length}
				<a
					href="/{page.params.hotel}/management/inventory/shopping-list"
					class="mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm hover:bg-surface-2"
				>
					<ShoppingCartIcon class="size-4 shrink-0 text-ink" aria-hidden="true" />
					<span class="min-w-0 flex-1 truncate"
						><span class="font-semibold text-ink">{toOrder.length} to order</span>
						<span class="text-ink-muted">· {toOrder.map((r) => r.name).join(' · ')}</span></span
					>
					<span class="shrink-0 font-medium text-ink">Shopping list →</span>
				</a>
			{/if}
		{/if}

		<div class="mt-4 flex flex-wrap items-center gap-3">
			<ToggleGroup.Root
				type="single"
				variant="outline"
				value={dept || 'all'}
				onValueChange={(v) => v && (dept = v === 'all' ? '' : (v as Dept))}
				aria-label="Department"
			>
				{#each [{ key: 'all', label: 'All' }, ...DEPTS] as d (d.key)}
					<ToggleGroup.Item value={d.key} class="px-3">{d.label}</ToggleGroup.Item>
				{/each}
			</ToggleGroup.Root>
			<div class="relative min-w-56 flex-1">
				<SearchIcon class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
				<Input bind:value={query} type="search" placeholder="Search items" aria-label="Search items" class="pl-9" />
			</div>
			<Button variant={lowOnly ? 'default' : 'outline'} class="" aria-pressed={lowOnly} onclick={() => (lowOnly = !lowOnly)}>Low only</Button>
		</div>
	</div>

	{#each groups as g (g.key)}
		<section class="mt-6 max-w-4xl" aria-labelledby="dept-{g.key}">
			<h3 id="dept-{g.key}" class="border-b border-border pb-2 text-sm font-semibold tracking-wide text-ink uppercase">
				{g.label}<span class="ml-1 font-normal tabular-nums text-ink-muted">{g.rows.length}</span>
			</h3>
			<ul class="divide-y divide-border">
				{#each g.rows as r (r.id)}
					<li class="flex items-center gap-3 py-2.5">
						<div class="min-w-0 flex-1">
							<p class="truncate text-base {r.isActive ?'text-ink' : 'text-ink-muted'}">
								{r.name}
								{#if r.kind === 'reusable'}<span class="ml-1 text-xs text-ink-muted">reusable</span>{/if}
								{#if !r.isActive}<span class="ml-1 text-xs text-ink-muted">inactive</span>{/if}
							</p>
							{#if leftOf(r.id) || r.nextExpiry}
								<p class="text-xs text-ink-muted">
									{#if leftOf(r.id)}<span class={data.ahead[r.id]?.needsOrder ? 'font-medium text-warning' : ''}>{leftOf(r.id)}</span>{/if}{#if leftOf(r.id) && r.nextExpiry}
										·
									{/if}{#if r.nextExpiry}Next expiry {fmtDate(r.nextExpiry)}{/if}
								</p>
							{/if}
						</div>
						{#if r.onHandMilli < 0}
							<span class="rounded bg-danger/10 px-1.5 py-0.5 text-xs font-medium text-danger">Below zero</span>
						{:else if r.isLow}
							<span class="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-ink">Low</span>
						{/if}
						<span class="w-28 text-right text-base font-medium tabular-nums {r.onHandMilli < 0 ?'text-danger' : 'text-ink'}">
							{formatQty(r.onHandMilli, r.unit)}
						</span>
						{#if data.inventory.canWrite && r.isActive}
							<Button variant="outline" class="gap-1.5" href="/{page.params.hotel}/management/inventory/restock/new?item={r.id}" aria-label="Restock {r.name}">
								<PackagePlusIcon class="size-4" aria-hidden="true" /><span class="hidden sm:inline">Restock</span>
							</Button>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button {...props} variant="ghost" size="icon" class="" aria-label="More for {r.name}">
											<EllipsisIcon class="size-4" />
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Item onSelect={() => open('remove', r)}>Record waste</DropdownMenu.Item>
									<DropdownMenu.Item onSelect={() => open('count', r)}>Correct count</DropdownMenu.Item>
									<DropdownMenu.Item onSelect={() => goto(`/${page.params.hotel}/management/inventory/movements?item=${r.id}`)}>
										See movements
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<div class="mt-8 max-w-4xl rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
			{#if data.stock.length === 0}
				<p class="font-medium text-ink">No stock items yet.</p>
				{#if data.inventory.canManage}
					<p class="mt-1">
						<a class="underline" href="/{page.params.hotel}/management/inventory/items">Add your items</a> — rice, soap, towels — then encode your first delivery in Restock.
					</p>
				{:else}
					<p class="mt-1">Ask a hotel admin to add the items you keep in stock.</p>
				{/if}
			{:else}
				No items match.
			{/if}
		</div>
	{/each}

	{#if inactiveCount > 0}
		<button type="button" class="mt-4 text-sm text-ink-muted underline" onclick={() => (showInactive = !showInactive)}>
			{showInactive ? 'Hide' : 'Show'} {inactiveCount} inactive
		</button>
	{/if}
</div>

<Sheet.Root bind:open={sheet.open}>
	<Sheet.Content side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-md">
		{#if item}
			<Sheet.Header class="border-b border-border px-5 py-4">
				<Sheet.Title>{TITLES[sheet.mode]}: {item.name}</Sheet.Title>
				<Sheet.Description>On hand now: <span class="tabular-nums">{formatQty(item.onHandMilli, item.unit)}</span></Sheet.Description>
			</Sheet.Header>
			<form
				method="POST"
				action="?/{sheet.mode}"
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
				<input type="hidden" name="itemId" value={item.id} />
				<input type="hidden" name="unit" value={unit} />

				<div>
					<Label for="qty">{sheet.mode === 'count' ? 'Counted on the shelf' : 'Quantity wasted'}</Label>
					<div class="mt-1 flex gap-2">
						<Input id="qty" name="qty" bind:value={qty} type="number" min="0" step="any" inputmode="decimal" class="flex-1 tabular-nums" required />
						<Select.Root type="single" bind:value={unit}>
							<Select.Trigger id="qtyUnit" class="w-24" aria-label="Unit">{unitLabel}</Select.Trigger>
							<Select.Content>
								{#each units as u (u.key)}<Select.Item value={u.key} label={u.label} />{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>

				{#if after != null && entered != null}
					<p class="text-sm text-ink-muted" aria-live="polite">
						On hand after: <span class="font-medium tabular-nums {after < 0 ?'text-danger' : 'text-ink'}">{formatQty(after, item.unit)}</span>
						{#if sheet.mode === 'count' && after !== item.onHandMilli}
							({after > item.onHandMilli ? '+' : ''}{formatQty(after - item.onHandMilli, item.unit)})
						{/if}
					</p>
					{#if after < 0}
						<p class="text-sm text-danger">This takes stock below zero. It still saves; correct the count once you have checked the shelf.</p>
					{/if}
				{/if}

				<div>
					<Label for="note">Reason</Label>
					<Textarea
						id="note"
						name="note"
						rows={2}
						maxlength={300}
						required
						class="mt-1"
						placeholder={sheet.mode === 'remove' ? 'Spoiled, dropped, expired…' : sheet.mode === 'count' ? 'Monthly count, found extra in storeroom…' : ''}
					/>
				</div>

				<div class="mt-auto flex justify-end gap-2 border-t border-border pt-4">
					<Button type="button" variant="outline" class="" onclick={() => (sheet.open = false)}>Cancel</Button>
					<Button type="submit" class="" disabled={busy || entered == null || (sheet.mode !== 'count' && entered <= 0)}>
						{sheet.mode === 'remove' ? 'Record waste' : 'Save count'}
					</Button>
				</div>
			</form>
		{/if}
	</Sheet.Content>
</Sheet.Root>
