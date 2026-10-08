<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import StorefrontFooter from '$lib/components/storefront/storefront-footer.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import XIcon from '@lucide/svelte/icons/x';
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import { checkAddonSelection, priceLine, sumLines } from '$lib/dining-orders';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The shared guest layout guarantees a hotel (it 404s otherwise); its type is just nullable.
	const hotel = $derived(page.data.hotel!);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	type Item = PageData['menu']['items'][number];
	type Group = PageData['menu']['groups'][number];

	// ---- menu, grouped by section -----------------------------------------------------
	let category = $state('all');
	const sections = $derived.by(() => {
		const out = data.menu.categories.map((c) => ({ id: c.id, name: c.name, items: data.menu.items.filter((i) => i.categoryId === c.id) }));
		const loose = data.menu.items.filter((i) => !data.menu.categories.some((c) => c.id === i.categoryId));
		if (loose.length) out.push({ id: 'other', name: out.length ? 'Also' : '', items: loose });
		return out.filter((s) => s.items.length > 0 && (category === 'all' || s.id === category));
	});
	const chips = $derived(data.menu.categories.filter((c) => data.menu.items.some((i) => i.categoryId === c.id)));
	const groupsFor = (item: Item): Group[] => data.menu.groups.filter((g) => item.addonGroupIds.includes(g.id));

	// ---- cart -------------------------------------------------------------------------
	interface CartLine {
		key: number;
		item: Item;
		addons: { id: string; name: string; priceCentavos: number }[];
		quantity: number;
		remarks: string;
	}
	let cart = $state<CartLine[]>([]);
	let keySeq = 0;
	let editing = $state<{ item: Item; picks: Record<string, string[]>; quantity: number; remarks: string } | null>(null);
	let editError = $state('');

	function startItem(item: Item) {
		if (!item.isAvailable) return;
		if (editing?.item.id === item.id) {
			editing = null;
			return;
		}
		if (groupsFor(item).length === 0) {
			addToCart(item, [], 1, '');
			return;
		}
		editing = { item, picks: {}, quantity: 1, remarks: '' };
		editError = '';
	}
	function addToCart(item: Item, addons: CartLine['addons'], quantity: number, remarks: string) {
		const sig = (a: CartLine['addons']) => a.map((x) => x.id).sort().join(',');
		const same = cart.find((l) => l.item.id === item.id && sig(l.addons) === sig(addons) && l.remarks === remarks);
		if (same) same.quantity = Math.min(50, same.quantity + quantity);
		else cart.push({ key: ++keySeq, item, addons, quantity, remarks });
	}
	function togglePick(groupId: string, addonId: string, max: number | null) {
		if (!editing) return;
		const cur = editing.picks[groupId] ?? [];
		if (cur.includes(addonId)) editing.picks[groupId] = cur.filter((x) => x !== addonId);
		else if (max === 1) editing.picks[groupId] = [addonId];
		else editing.picks[groupId] = [...cur, addonId];
		editError = '';
	}
	function confirmEditing() {
		if (!editing) return;
		const groups = groupsFor(editing.item);
		const counts: Record<string, number> = {};
		for (const g of groups) counts[g.id] = (editing.picks[g.id] ?? []).length;
		const problem = checkAddonSelection(editing.item.name, groups.map((g) => ({ id: g.id, name: g.name, minChoices: g.minChoices, maxChoices: g.maxChoices })), counts);
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

	const priced = $derived(cart.map((l) => priceLine({ unitPriceCentavos: l.item.priceCentavos, addonPricesCentavos: l.addons.map((a) => a.priceCentavos), quantity: l.quantity, taxable: true, vatRateBps: 0 })));
	const total = $derived(sumLines(priced).totalCentavos);
	const itemCount = $derived(cart.reduce((n, l) => n + l.quantity, 0));

	let guestName = $state('');
	let remarks = $state('');
	let honeypot = $state('');
	let submitting = $state(false);
	const payload = $derived(
		JSON.stringify({
			guestName: guestName || undefined,
			remarks: remarks || undefined,
			website: honeypot || undefined,
			lines: cart.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, remarks: l.remarks || undefined, addonIds: l.addons.map((a) => a.id) }))
		})
	);

	// ---- this table's orders: where each one is ----------------------------------------
	const STATUS: Record<string, string> = {
		pending_acceptance: 'Waiting for the restaurant to confirm',
		new: 'Sent to the kitchen',
		accepted: 'Sent to the kitchen',
		preparing: 'Being prepared',
		ready: 'Ready, on its way to your table',
		served: 'Served',
		cancelled: 'Not accepted'
	};
	const live = $derived(data.orders.some((o) => o.status !== 'served' && o.status !== 'cancelled'));
	$effect(() => {
		if (!live && !data.checkOpen) return;
		const t = setInterval(() => {
			if (!document.hidden) invalidate('app:dining-qr');
		}, 10_000);
		return () => clearInterval(t);
	});
	const sent = $derived(page.url.searchParams.get('sent'));
	const stamp = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: hotel.timezone }).format(new Date(iso));
	const billTotal = $derived(data.orders.filter((o) => o.status !== 'cancelled' && o.paymentStatus === 'unpaid').reduce((s, o) => s + o.totalCentavos, 0));
</script>

<svelte:head>
	<title>Table {data.table.name} · {data.table.venueTitle} — {hotel.name}</title>
</svelte:head>

<StorefrontNav
	hotelSlug={hotel.slug}
	hotelName={hotel.name}
	logoUrl={page.data.branding.logoUrl}
	showAmenities={page.data.hotelAmenities.length > 0}
	showFunctionHall={page.data.functionHalls.length > 0}
	showDining={true}
	showReviews={page.data.reviews.length > 0}
	accent={page.data.theme.accent}
	accentDeep={page.data.theme.accentDeep}
	paper={page.data.theme.paper}
	paperDeep={page.data.theme.paperDeep}
/>

<section class="storefront-section">
	<div class="mx-auto max-w-5xl">
		<p class="ledger-label">{data.table.venueTitle}</p>
		<h1 class="storefront-section-title ink-heading ledger-display mt-1 text-3xl sm:text-4xl">Table {data.table.name}</h1>
		{#if data.table.areaName}<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">{data.table.areaName}</p>{/if}
		<p class="storefront-section-lede mt-3 text-[0.9375rem] leading-relaxed">
			Choose your dishes and send them to the kitchen. A waiter confirms each order first. You pay at the table when you are done.
		</p>

		{#if sent}
			<p class="mt-5 border-y border-[var(--hotel-accent)] py-3 text-sm" role="status">
				Order <span class="ledger-data">{sent}</span> is on its way to the restaurant. We will confirm it in a moment.
			</p>
		{/if}
		{#if form?.ok}<p class="mt-5 border-y border-[var(--hotel-accent)] py-3 text-sm" role="status">{form.ok}</p>{/if}
		{#if form?.error}<p role="alert" class="mt-5 border-y border-[var(--ledger-danger)] py-3 text-sm text-[var(--ledger-danger)]">{form.error}</p>{/if}

		<!-- What this table has already ordered -->
		{#if data.orders.length > 0}
			<section class="mt-8" aria-label="Your orders at this table">
				<h2 class="ledger-label border-b border-[var(--ledger-ink)] pb-2">Your orders</h2>
				<ul>
					{#each data.orders as o (o.code)}
						<li class="order-line items-start">
							<div class="min-w-0 flex-1">
								<p class="flex flex-wrap items-baseline gap-x-2">
									<span class="ledger-data text-sm">{o.code}</span>
									<span class="text-xs text-[var(--ledger-ink-muted)]">{stamp(o.createdAt)}</span>
								</p>
								<p class="mt-0.5 text-sm font-medium {o.status === 'cancelled' ? 'text-[var(--ledger-danger)]' : ''}">{STATUS[o.status] ?? o.status}</p>
								{#if o.status === 'cancelled' && o.cancelReason}
									<p class="storefront-menu-desc">{o.cancelReason}</p>
								{/if}
								<ul class="mt-1">
									{#each o.items as i, idx (idx)}
										<li class="storefront-menu-desc"><span class="ledger-data">{i.quantity}×</span> {i.name}{i.addons.length ? ` (${i.addons.join(', ')})` : ''}</li>
									{/each}
								</ul>
								{#if o.status === 'pending_acceptance'}
									<form method="POST" action="?/cancel" use:enhance={() => async ({ update }) => { await update({ reset: false }); await invalidate('app:dining-qr'); }} class="mt-2">
										<input type="hidden" name="code" value={o.code} />
										<button type="submit" class="text-sm underline">Cancel this order</button>
									</form>
								{/if}
							</div>
							<span class="ledger-data">{peso(o.totalCentavos)}</span>
						</li>
					{/each}
				</ul>
				{#if data.checkOpen}
					<div class="order-total">
						<span>Your bill so far <span class="text-xs text-[var(--ledger-ink-muted)]">VAT included</span></span>
						<span class="ledger-data text-lg">{peso(billTotal)}</span>
					</div>
					{#if data.billRequested}
						<p class="mt-3 text-sm text-[var(--ledger-ink-muted)]">We know you would like the bill. Your waiter is on the way.</p>
					{:else}
						<form method="POST" action="?/bill" use:enhance={() => async ({ update }) => { await update({ reset: false }); await invalidate('app:dining-qr'); }} class="mt-3">
							<button type="submit" class="ledger-btn-primary min-h-11 px-5">Ask for the bill</button>
						</form>
					{/if}
				{/if}
			</section>
		{/if}

		<div class="mt-10 grid gap-10 lg:grid-cols-[1fr_21rem]">
			<!-- Menu -->
			<div>
				{#if chips.length > 1}
					<div class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Menu sections">
						<button type="button" role="tab" aria-selected={category === 'all'} class="order-chip shrink-0" class:is-on={category === 'all'} onclick={() => (category = 'all')}>All</button>
						{#each chips as c (c.id)}
							<button type="button" role="tab" aria-selected={category === c.id} class="order-chip shrink-0" class:is-on={category === c.id} onclick={() => (category = c.id)}>{c.name}</button>
						{/each}
					</div>
				{/if}

				{#each sections as section (section.id)}
					{#if section.name}<h2 class="storefront-menu-category ledger-display">{section.name}</h2>{/if}
					<ul>
						{#each section.items as item (item.id)}
							{@const open = editing?.item.id === item.id}
							<li class="order-dish" class:is-sold-out={!item.isAvailable}>
								<button type="button" class="order-row" class:has-photo={item.imageUrl} disabled={!item.isAvailable} aria-expanded={open} onclick={() => startItem(item)}>
									<span class="min-w-0 flex-1">
										<span class="storefront-menu-name">{item.name}{#if !item.isAvailable}<span class="storefront-menu-flag">Sold out today</span>{/if}</span>
										{#if item.description}<span class="storefront-menu-desc block">{item.description}</span>{/if}
									</span>
									{#if item.imageUrl}
										<span class="storefront-menu-photo" aria-hidden="true">
											<img src={item.imageUrl} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
										</span>
									{/if}
									<span class="ledger-data">{peso(item.priceCentavos)}</span>
									{#if item.isAvailable}
										<span class="order-add" aria-hidden="true">{#if groupsFor(item).length > 0}{open ? '−' : '+'}{:else}+{/if}</span>
										<span class="sr-only">{groupsFor(item).length > 0 ? 'Choose options' : 'Add to order'}</span>
									{/if}
								</button>

								{#if open && editing}
									<div class="order-addons">
										{#each groupsFor(item) as g (g.id)}
											<fieldset>
												<legend class="ledger-label">
													{g.name}
													<span class="normal-case tracking-normal">· {g.minChoices > 0 ? (g.maxChoices === 1 ? 'choose 1' : `choose ${g.minChoices}${g.maxChoices ? `–${g.maxChoices}` : ' or more'}`) : g.maxChoices ? `optional, up to ${g.maxChoices}` : 'optional'}</span>
												</legend>
												<div class="mt-2 grid gap-2 sm:grid-cols-2">
													{#each g.addons as a (a.id)}
														<Label class="order-choice {a.isAvailable ? '' : 'is-off'}">
															<Checkbox checked={(editing.picks[g.id] ?? []).includes(a.id)} disabled={!a.isAvailable} onCheckedChange={() => togglePick(g.id, a.id, g.maxChoices)} />
															<span class="flex-1">{a.name}</span>
															<span class="ledger-data text-xs">{a.priceCentavos ? `+${peso(a.priceCentavos)}` : 'free'}</span>
														</Label>
													{/each}
												</div>
											</fieldset>
										{/each}
										<div>
											<Label for="lineNote" class="ledger-label">A note for the kitchen (optional)</Label>
											<Input id="lineNote" bind:value={editing.remarks} maxlength={300} placeholder="No onions, extra spicy" class="ledger-field mt-1" />
										</div>
										{#if editError}<p role="alert" class="text-sm text-[var(--ledger-danger)]">{editError}</p>{/if}
										<div class="flex flex-wrap items-center justify-between gap-3">
											<div class="order-stepper" role="group" aria-label="Quantity">
												<button type="button" aria-label="Fewer" onclick={() => editing && editing.quantity > 1 && editing.quantity--}><MinusIcon class="size-4" /></button>
												<span class="ledger-data">{editing.quantity}</span>
												<button type="button" aria-label="More" onclick={() => editing && editing.quantity < 50 && editing.quantity++}><PlusIcon class="size-4" /></button>
											</div>
											<button type="button" class="ledger-btn-primary min-h-11 px-5" onclick={confirmEditing}>Add to order</button>
										</div>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-8 text-sm text-[var(--ledger-ink-muted)]">The menu is not available just now. Please ask your waiter.</p>
				{/each}
			</div>

			<!-- Your cart, then send -->
			<aside id="order" class="order-ledger" aria-label="Your new order">
				<h2 class="ledger-label border-b border-[var(--ledger-ink)] pb-2">New order</h2>
				{#if cart.length === 0}
					<p class="mt-4 text-sm text-[var(--ledger-ink-muted)]">Nothing yet. Pick a dish from the menu.</p>
				{:else}
					<ul>
						{#each cart as l, i (l.key)}
							<li class="order-line">
								<div class="min-w-0 flex-1">
									<p class="storefront-menu-name">{l.item.name}</p>
									{#each l.addons as a (a.id)}<p class="storefront-menu-desc">+ {a.name}</p>{/each}
									{#if l.remarks}<p class="storefront-menu-desc italic">“{l.remarks}”</p>{/if}
									<div class="order-stepper mt-1.5" role="group" aria-label="Quantity of {l.item.name}">
										<button type="button" aria-label="Fewer" onclick={() => (l.quantity > 1 ? l.quantity-- : cart.splice(i, 1))}><MinusIcon class="size-3.5" /></button>
										<span class="ledger-data">{l.quantity}</span>
										<button type="button" aria-label="More" onclick={() => l.quantity < 50 && l.quantity++}><PlusIcon class="size-3.5" /></button>
									</div>
								</div>
								<span class="ledger-data">{peso(priced[i]!.lineTotalCentavos)}</span>
								<button type="button" class="order-remove" aria-label="Remove {l.item.name}" onclick={() => cart.splice(i, 1)}><XIcon class="size-3.5" /></button>
							</li>
						{/each}
					</ul>
					<div class="order-total">
						<span>This round <span class="text-xs text-[var(--ledger-ink-muted)]">VAT included</span></span>
						<span class="ledger-data text-lg">{peso(total)}</span>
					</div>

					<form
						method="POST"
						action="?/place"
						class="mt-5 space-y-4"
						use:enhance={() => {
							submitting = true;
							return async ({ result, update }) => {
								submitting = false;
								if (result.type === 'redirect') cart = [];
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="payload" value={payload} />
						<div class="absolute -left-[9999px]" aria-hidden="true">
							<label>Website <input type="text" tabindex="-1" autocomplete="off" bind:value={honeypot} /></label>
						</div>
						<div>
							<Label for="qrName" class="ledger-label">Your name (optional)</Label>
							<Input id="qrName" bind:value={guestName} maxlength={60} autocomplete="given-name" class="ledger-field mt-1" />
						</div>
						<div>
							<Label for="qrNote" class="ledger-label">Anything we should know (optional)</Label>
							<Textarea id="qrNote" bind:value={remarks} rows={2} maxlength={500} placeholder="Allergies, serve together" class="ledger-field mt-1" />
						</div>
						<button type="submit" class="ledger-btn-primary min-h-12 w-full" disabled={submitting}>
							{submitting ? 'Sending…' : `Send to the kitchen · ${peso(total)}`}
						</button>
						<p class="text-xs text-[var(--ledger-ink-muted)]">No payment now. A waiter confirms your order, and you pay at the table.</p>
					</form>
				{/if}
			</aside>
		</div>
	</div>
</section>

{#if cart.length > 0}
	<a href="#order" class="order-pill lg:hidden" aria-label="View your new order, {itemCount} items, {peso(total)}">
		<ShoppingBagIcon class="size-4" aria-hidden="true" />
		<span>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
		<span class="ledger-data">{peso(total)}</span>
	</a>
{/if}

<StorefrontFooter
	hotelSlug={hotel.slug}
	hotelName={hotel.name}
	city={hotel.city}
	showAmenities={page.data.hotelAmenities.length > 0}
	showFunctionHall={page.data.functionHalls.length > 0}
	showDining={true}
	showReviews={page.data.reviews.length > 0}
	facebookUrl={page.data.branding.facebookUrl}
	instagramUrl={page.data.branding.instagramUrl}
	tiktokUrl={page.data.branding.tiktokUrl}
/>
