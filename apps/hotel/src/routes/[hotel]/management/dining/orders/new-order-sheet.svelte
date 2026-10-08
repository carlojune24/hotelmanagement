<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import XIcon from '@lucide/svelte/icons/x';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { checkAddonSelection, priceLine, sumLines } from '$lib/dining-orders';
	import type { PageData } from './$types';

	let {
		open = $bindable(false),
		data,
		defaultVenueId = null,
		defaultTableId = null,
		onplaced
	}: {
		open: boolean;
		data: PageData;
		defaultVenueId?: string | null;
		/** A table to start the order on (from the Floor); its venue wins over `defaultVenueId`. */
		defaultTableId?: string | null;
		/** Called after an order is saved. `payNow` means the cashier asked to take payment next. */
		onplaced: (order: { id: string; code: string }, payNow: boolean) => void;
	} = $props();

	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	type Menu = PageData['menus'][string];
	type Item = Menu['items'][number];

	const venuesWithMenu = $derived(data.venues.filter((v) => data.menus[v.id]));
	let venueId = $state('');
	const menu = $derived<Menu | null>(data.menus[venueId] ?? null);
	const venueTables = $derived(data.tables.filter((t) => t.venueId === venueId));

	let orderType = $state<'dine_in' | 'takeaway'>('dine_in');
	let tableId = $state('none');
	let guestName = $state('');
	let orderRemarks = $state('');
	let search = $state('');
	let category = $state('all');

	interface CartLine {
		key: number;
		item: Item;
		addons: { id: string; name: string; priceCentavos: number }[];
		quantity: number;
		remarks: string;
	}
	let cart = $state<CartLine[]>([]);
	let keySeq = 0;

	// The dish currently being customised (add-ons, quantity, remarks).
	let editing = $state<{ item: Item; picks: Record<string, string[]>; quantity: number; remarks: string } | null>(null);
	let editError = $state('');

	// Below the sheet's `@2xl` container width only one pane shows at a time.
	let pane = $state<'menu' | 'cart'>('menu');

	$effect(() => {
		// Only `open` is tracked. The board refreshes `data` every 20 s, and re-running this on
		// each refresh would wipe the cart mid-order.
		if (!open) return;
		untrack(() => {
			// Reset each time the sheet opens, on the venue being worked in.
			const preferred = defaultVenueId && data.menus[defaultVenueId] ? defaultVenueId : (venuesWithMenu[0]?.id ?? '');
			const startTable = defaultTableId ? data.tables.find((t) => t.id === defaultTableId && data.menus[t.venueId]) : undefined;
			venueId = startTable ? startTable.venueId : preferred;
			orderType = 'dine_in';
			tableId = startTable ? startTable.id : 'none';
			guestName = '';
			orderRemarks = '';
			search = '';
			category = 'all';
			cart = [];
			editing = null;
			pane = 'menu';
		});
	});

	// Switching venue empties the cart: dishes belong to one venue's menu.
	function changeVenue(v: string) {
		if (v === venueId) return;
		venueId = v;
		cart = [];
		editing = null;
		tableId = 'none';
		category = 'all';
	}

	const visibleItems = $derived(
		(menu?.items ?? []).filter((i) => {
			if (!i.isActive) return false;
			if (category !== 'all' && (category === 'none' ? i.categoryId : i.categoryId !== category)) return false;
			const q = search.trim().toLowerCase();
			return !q || i.name.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q);
		})
	);

	const groupsFor = (item: Item) => (menu?.groups ?? []).filter((g) => item.addonGroupIds.includes(g.id));

	function startItem(item: Item) {
		if (!item.isAvailable) return;
		if (groupsFor(item).length === 0) {
			addToCart(item, [], 1, '');
			return;
		}
		editing = { item, picks: {}, quantity: 1, remarks: '' };
		editError = '';
	}

	function addToCart(item: Item, addons: CartLine['addons'], quantity: number, remarks: string) {
		// An identical line (same dish, same add-ons, same note) just adds to its quantity.
		const sig = (a: CartLine['addons']) => a.map((x) => x.id).sort().join(',');
		const same = cart.find((l) => l.item.id === item.id && sig(l.addons) === sig(addons) && l.remarks === remarks);
		if (same) same.quantity = Math.min(50, same.quantity + quantity);
		else cart.push({ key: ++keySeq, item, addons, quantity, remarks });
	}

	function togglePick(groupId: string, addonId: string, max: number | null) {
		if (!editing) return;
		const cur = editing.picks[groupId] ?? [];
		if (cur.includes(addonId)) editing.picks[groupId] = cur.filter((x) => x !== addonId);
		else if (max === 1) editing.picks[groupId] = [addonId]; // single choice behaves like a radio
		else editing.picks[groupId] = [...cur, addonId];
		editError = '';
	}

	function confirmEditing() {
		if (!editing) return;
		const groups = groupsFor(editing.item);
		const counts: Record<string, number> = {};
		for (const g of groups) counts[g.id] = (editing.picks[g.id] ?? []).length;
		const problem = checkAddonSelection(
			editing.item.name,
			groups.map((g) => ({ id: g.id, name: g.name, minChoices: g.minChoices, maxChoices: g.maxChoices })),
			counts
		);
		if (problem) {
			editError = problem;
			return;
		}
		const chosen = groups.flatMap((g) =>
			g.addons.filter((a) => (editing!.picks[g.id] ?? []).includes(a.id)).map((a) => ({ id: a.id, name: a.name, priceCentavos: a.priceCentavos }))
		);
		addToCart(editing.item, chosen, editing.quantity, editing.remarks.trim());
		editing = null;
	}

	const priced = $derived(
		cart.map((l) =>
			priceLine({
				unitPriceCentavos: l.item.priceCentavos,
				addonPricesCentavos: l.addons.map((a) => a.priceCentavos),
				quantity: l.quantity,
				taxable: l.item.taxable,
				vatRateBps: data.vatRateBps
			})
		)
	);
	const total = $derived(sumLines(priced).totalCentavos);
	const itemCount = $derived(cart.reduce((n, l) => n + l.quantity, 0));

	const payload = $derived(
		JSON.stringify({
			venueId,
			orderType,
			tableId: tableId === 'none' ? null : tableId,
			guestName: guestName.trim() || undefined,
			remarks: orderRemarks.trim() || undefined,
			lines: cart.map((l) => ({
				menuItemId: l.item.id,
				quantity: l.quantity,
				remarks: l.remarks || undefined,
				addonIds: l.addons.map((a) => a.id)
			}))
		})
	);

	let submitting = $state(false);
	let payNowFlag = $state(false);
	const venueLabel = $derived(data.venues.find((v) => v.id === venueId)?.title ?? 'Choose a venue');
	const tableLabel = $derived(venueTables.find((t) => t.id === tableId)?.name ?? 'No table');
	const catName = (id: string) => menu?.categories.find((c) => c.id === id)?.name ?? '';
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col gap-0 p-0 sm:max-w-4xl">
		<Sheet.Header class="border-b border-border py-4 pr-14 pl-5">
			<Sheet.Title>New order</Sheet.Title>
			<Sheet.Description>Pick dishes, then review the order. Prices include VAT.</Sheet.Description>
		</Sheet.Header>

		{#if venuesWithMenu.length === 0}
			<div class="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
				<UtensilsIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">No menu yet. Add dishes on the Menu tab first.</p>
			</div>
		{:else}
			<!-- Narrow: Menu / Order switch. Wide (container ≥ 42rem): both panes side by side. -->
			<div class="@container flex min-h-0 flex-1 flex-col">
				<div class="border-b border-border px-5 py-2 @2xl:hidden">
					<Tabs.Root bind:value={pane}>
						<Tabs.List class="w-full">
							<Tabs.Trigger value="menu" class="flex-1">Menu</Tabs.Trigger>
							<Tabs.Trigger value="cart" class="flex-1">
								Order
								{#if itemCount > 0}<span class="ml-1.5 rounded-full bg-brand px-1.5 text-xs tabular-nums text-brand-ink">{itemCount}</span>{/if}
							</Tabs.Trigger>
						</Tabs.List>
					</Tabs.Root>
				</div>
			<div class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] @2xl:grid-cols-[minmax(0,1fr)_21rem]">
				<!-- Menu -->
				<section class="min-h-0 flex-col border-border @2xl:flex @2xl:border-r {pane === 'menu' ? 'flex' : 'hidden'}" aria-label="Menu">
					<div class="space-y-3 border-b border-border px-5 py-3">
						{#if venuesWithMenu.length > 1}
							<Select.Root type="single" value={venueId} onValueChange={changeVenue}>
								<Select.Trigger class="w-full" aria-label="Venue">{venueLabel}</Select.Trigger>
								<Select.Content>
									{#each venuesWithMenu as v (v.id)}<Select.Item value={v.id} label={v.title} />{/each}
								</Select.Content>
							</Select.Root>
						{/if}
						<div class="relative">
							<SearchIcon class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
							<Input bind:value={search} placeholder="Search the menu" aria-label="Search the menu" class="pl-8" />
						</div>
						{#if menu && menu.categories.length > 0}
							<Tabs.Root bind:value={category}>
								<Tabs.List class="h-auto w-full flex-wrap justify-start">
									<Tabs.Trigger value="all">All</Tabs.Trigger>
									{#each menu.categories as c (c.id)}<Tabs.Trigger value={c.id}>{c.name}</Tabs.Trigger>{/each}
									{#if menu.items.some((i) => !i.categoryId)}<Tabs.Trigger value="none">Other</Tabs.Trigger>{/if}
								</Tabs.List>
							</Tabs.Root>
						{/if}
					</div>

					<ul class="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
						{#each visibleItems as item (item.id)}
							{@const isEditing = editing?.item.id === item.id}
							<li>
								<button
									type="button"
									disabled={!item.isAvailable}
									class="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
									aria-expanded={isEditing}
									onclick={() => (isEditing ? (editing = null) : startItem(item))}
								>
									{#if item.imageUrl}
										<img src={item.imageUrl} alt="" loading="lazy" class="size-12 shrink-0 rounded-md object-cover {item.isAvailable ? '' : 'grayscale'}" />
									{/if}
									<span class="min-w-0 flex-1">
										<span class="block font-medium text-ink {item.isAvailable ? '' : 'line-through'}">{item.name}</span>
										{#if item.description}<span class="line-clamp-1 text-xs text-ink-muted">{item.description}</span>{/if}
										{#if category === 'all' && item.categoryId}<span class="text-xs text-ink-muted">{catName(item.categoryId)}</span>{/if}
									</span>
									{#if !item.isAvailable}
										<span class="text-xs text-ink-muted">Sold out</span>
									{:else if groupsFor(item).length > 0}
										<ChevronDownIcon class="size-4 text-ink-muted transition-transform {isEditing ? 'rotate-180' : ''}" aria-hidden="true" />
									{:else}
										<PlusIcon class="size-4 text-ink-muted" aria-hidden="true" />
									{/if}
									<span class="min-w-16 shrink-0 text-right text-sm font-medium tabular-nums text-ink">{peso(item.priceCentavos)}</span>
								</button>

								{#if isEditing && editing}
									<div class="space-y-4 border-t border-border bg-surface-2/50 px-5 py-4">
										{#each groupsFor(item) as g (g.id)}
											<fieldset>
												<legend class="text-sm font-medium text-ink">
													{g.name}
													<span class="ml-1 text-xs font-normal text-ink-muted">
														{g.minChoices > 0 ? (g.maxChoices === 1 ? 'Choose 1' : `Choose ${g.minChoices}${g.maxChoices ? `–${g.maxChoices}` : '+'}`) : g.maxChoices ? `Optional, up to ${g.maxChoices}` : 'Optional'}
													</span>
												</legend>
												<div class="mt-2 grid gap-1.5 sm:grid-cols-2">
													{#each g.addons as a (a.id)}
														{@const on = (editing.picks[g.id] ?? []).includes(a.id)}
														<Label class="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal {a.isAvailable ? '' : 'opacity-50'}">
															<Checkbox checked={on} disabled={!a.isAvailable} onCheckedChange={() => togglePick(g.id, a.id, g.maxChoices)} />
															<span class="flex-1 text-ink">{a.name}</span>
															<span class="text-xs tabular-nums text-ink-muted">{a.priceCentavos ? `+${peso(a.priceCentavos)}` : 'Free'}</span>
														</Label>
													{/each}
												</div>
											</fieldset>
										{/each}
										<div>
											<Label for="lineRemarks" class="text-xs">Note for the kitchen (optional)</Label>
											<Input id="lineRemarks" bind:value={editing.remarks} maxlength={300} placeholder="No onions, extra spicy…" class="mt-1" />
										</div>
										{#if editError}<p role="alert" class="text-sm text-danger">{editError}</p>{/if}
										<div class="sticky bottom-0 -mx-5 -mb-4 flex items-center justify-between gap-3 border-t border-border bg-popover px-5 py-3">
											<div class="flex items-center gap-1" role="group" aria-label="Quantity">
												<Button type="button" variant="outline" size="icon" class="size-8" aria-label="Fewer" onclick={() => editing && editing.quantity > 1 && editing.quantity--}><MinusIcon class="size-4" /></Button>
												<span class="w-8 text-center text-sm tabular-nums">{editing.quantity}</span>
												<Button type="button" variant="outline" size="icon" class="size-8" aria-label="More" onclick={() => editing && editing.quantity < 50 && editing.quantity++}><PlusIcon class="size-4" /></Button>
											</div>
											<Button type="button" onclick={confirmEditing}>Add to order</Button>
										</div>
									</div>
								{/if}
							</li>
						{:else}
							<li class="p-10 text-center text-sm text-ink-muted">Nothing matches.</li>
						{/each}
					</ul>

					{#if itemCount > 0}
						<div class="flex items-center justify-between gap-3 border-t border-border bg-popover px-5 py-3 @2xl:hidden">
							<span class="text-sm text-ink-muted">
								{itemCount} {itemCount === 1 ? 'item' : 'items'} · <span class="font-semibold tabular-nums text-ink">{peso(total)}</span>
							</span>
							<Button type="button" onclick={() => (pane = 'cart')}>View order</Button>
						</div>
					{/if}
				</section>

				<!-- Cart -->
				<aside class="min-h-0 flex-col @2xl:flex {pane === 'cart' ? 'flex' : 'hidden'}" aria-label="This order">
					<div class="space-y-3 border-b border-border px-5 py-3">
						<ToggleGroup.Root type="single" bind:value={orderType} variant="outline" class="w-full">
							<ToggleGroup.Item value="dine_in" class="flex-1">Dine-in</ToggleGroup.Item>
							<ToggleGroup.Item value="takeaway" class="flex-1">Takeaway</ToggleGroup.Item>
						</ToggleGroup.Root>
						{#if orderType === 'dine_in' && venueTables.length > 0}
							<Select.Root type="single" bind:value={tableId}>
								<Select.Trigger class="w-full [&>span]:truncate" aria-label="Table">{tableLabel}</Select.Trigger>
								<Select.Content>
									<Select.Item value="none" label="No table" />
									{#each venueTables as t (t.id)}<Select.Item value={t.id} label="{t.name} ({t.seats})" />{/each}
								</Select.Content>
							</Select.Root>
						{/if}
						<Input bind:value={guestName} maxlength={120} placeholder="Guest name (optional)" aria-label="Guest name" />
					</div>

					<ul class="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
						{#each cart as l, i (l.key)}
							<li class="px-5 py-3">
								<div class="flex items-start gap-2">
									<div class="min-w-0 flex-1">
										<p class="text-sm font-medium text-ink">{l.item.name}</p>
										{#each l.addons as a (a.id)}<p class="text-xs text-ink-muted">+ {a.name}</p>{/each}
										{#if l.remarks}<p class="text-xs italic text-ink-muted">“{l.remarks}”</p>{/if}
									</div>
									<span class="text-sm tabular-nums text-ink">{peso(priced[i]!.lineTotalCentavos)}</span>
									<Button type="button" variant="ghost" size="icon" class="size-6" aria-label="Remove {l.item.name}" onclick={() => cart.splice(i, 1)}><XIcon class="size-3.5" /></Button>
								</div>
								<div class="mt-1.5 flex items-center gap-1" role="group" aria-label="Quantity of {l.item.name}">
									<Button type="button" variant="outline" size="icon" class="size-7" aria-label="Fewer" onclick={() => (l.quantity > 1 ? l.quantity-- : cart.splice(i, 1))}><MinusIcon class="size-3.5" /></Button>
									<span class="w-7 text-center text-sm tabular-nums">{l.quantity}</span>
									<Button type="button" variant="outline" size="icon" class="size-7" aria-label="More" onclick={() => l.quantity < 50 && l.quantity++}><PlusIcon class="size-3.5" /></Button>
								</div>
							</li>
						{:else}
							<li class="p-8 text-center text-sm text-ink-muted">No items yet. Pick a dish from the menu.</li>
						{/each}
					</ul>

					<form
						method="POST"
						action="?/create"
						class="space-y-3 border-t border-border px-5 py-4"
						use:enhance={() => {
							submitting = true;
							return async ({ result, update }) => {
								submitting = false;
								if (result.type === 'success' && result.data?.placed) {
									const placed = result.data.placed as { id: string; code: string };
									open = false;
									await update({ reset: false });
									toast.success(`Order ${placed.code} placed.`);
									onplaced(placed, payNowFlag);
								} else {
									await update({ reset: false });
								}
							};
						}}
					>
						<input type="hidden" name="payload" value={payload} />
						<Textarea bind:value={orderRemarks} rows={2} maxlength={500} placeholder="Order note (optional)" aria-label="Order note" class="min-h-0" />
						<div class="flex items-baseline justify-between">
							<span class="text-sm text-ink-muted">{itemCount} {itemCount === 1 ? 'item' : 'items'} · VAT included</span>
							<span class="text-xl font-semibold tabular-nums text-ink">{peso(total)}</span>
						</div>
						<div class="grid grid-cols-2 gap-2">
							<Button type="submit" variant="outline" disabled={cart.length === 0 || submitting} onclick={() => (payNowFlag = false)}>Place order</Button>
							<Button type="submit" disabled={cart.length === 0 || submitting} onclick={() => (payNowFlag = true)}>Place &amp; pay</Button>
						</div>
					</form>
				</aside>
			</div>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
