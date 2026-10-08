<script lang="ts">
	import { enhance } from '$app/forms';
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
	import { addDays } from '$lib/dining-sales-range';
	import { listSlots, localParts } from '$lib/dining-slots';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The shared guest layout guarantees a hotel (it 404s otherwise); its type is just nullable.
	const hotel = $derived(page.data.hotel!);
	const isPre = $derived(data.reservation !== null);
	const tz = $derived(data.timezone);

	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const clock = (hhmm: string) =>
		new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`1970-01-01T${hhmm}:00Z`));
	const dayLabel = (d: string) =>
		new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
	const longDay = (d: string) =>
		new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

	type Item = PageData['menu']['items'][number];
	type Group = PageData['menu']['groups'][number];

	// ---- menu and cart ------------------------------------------------------------
	let category = $state('all');
	const catName = (id: string | null) => data.menu.categories.find((c) => c.id === id)?.name ?? '';
	const sections = $derived.by(() => {
		const out = data.menu.categories.map((c) => ({ id: c.id, name: c.name, items: data.menu.items.filter((i) => i.categoryId === c.id) }));
		const loose = data.menu.items.filter((i) => !data.menu.categories.some((c) => c.id === i.categoryId));
		if (loose.length) out.push({ id: 'other', name: out.length ? 'Also' : '', items: loose });
		return out.filter((s) => s.items.length > 0 && (category === 'all' || s.id === category));
	});
	const groupsFor = (item: Item): Group[] => data.menu.groups.filter((g) => item.addonGroupIds.includes(g.id));

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

	// ---- pickup time (computed here, re-checked by the server) ----------------------
	const days = $derived.by(() => {
		const now = new Date(data.nowIso);
		const today = localParts(now, tz).date;
		const cfg = { seatingOpen: data.cfg.orderOpen, lastSeating: data.cfg.orderClose, slotMinutes: 15, turnMinutes: 15, minNoticeMinutes: data.cfg.prepMinutes, advanceDays: 7, maxPartySize: 1 };
		return Array.from({ length: 7 }, (_, i) => addDays(today, i))
			.map((date) => ({ date, slots: listSlots(cfg, date, tz, now).map((s) => s.time) }))
			.filter((d) => d.slots.length > 0);
	});
	let pickDate = $state('');
	let pickTime = $state('');
	$effect(() => {
		if (!isPre && !days.some((d) => d.date === pickDate)) {
			pickDate = days[0]?.date ?? '';
			pickTime = '';
		}
	});
	const timesForDay = $derived(days.find((d) => d.date === pickDate)?.slots ?? []);

	// ---- details and payment --------------------------------------------------------
	let guestName = $state('');
	let guestPhone = $state('');
	let guestEmail = $state('');
	let remarks = $state('');
	let honeypot = $state('');
	let payMode = $state<'online' | 'venue'>('online');
	$effect(() => {
		payMode = data.cfg.canPayOnline ? 'online' : 'venue';
	});

	const ready = $derived(cart.length > 0 && guestName.trim().length > 0 && guestPhone.trim().length >= 5 && (isPre || (pickDate && pickTime)));
	let submitting = $state(false);

	const payload = $derived(
		JSON.stringify({
			venueId: data.venue.id,
			orderType: isPre ? 'pre_order' : 'takeaway',
			date: isPre ? undefined : pickDate || undefined,
			time: isPre ? undefined : pickTime || undefined,
			reservation: data.reservation ? { code: data.reservation.code, token: data.reservation.token } : undefined,
			guestName,
			guestPhone,
			guestEmail,
			remarks: remarks || undefined,
			payMode,
			website: honeypot || undefined,
			lines: cart.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, remarks: l.remarks || undefined, addonIds: l.addons.map((a) => a.id) }))
		})
	);

	const heading = $derived(isPre ? 'Pre-order for your table' : 'Order for pickup');
	const lede = $derived(
		isPre
			? `Choose your dishes now and they will be ready when you sit down on ${longDay(data.reservation!.local.date)} at ${clock(data.reservation!.local.time)}.`
			: `Choose your dishes and a pickup time. Pickup times run ${clock(data.cfg.orderOpen)} to ${clock(data.cfg.orderClose)}, at least ${data.cfg.prepMinutes} minutes ahead.`
	);
	let venueForm: HTMLFormElement | undefined = $state();
</script>

<svelte:head>
	<title>{heading} — {hotel.name}</title>
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
		<a href={isPre ? `/${hotel.slug}/dining/reserve/${data.reservation!.code}?t=${data.reservation!.token}` : `/${hotel.slug}/dining`} class="storefront-step-back">
			← {isPre ? 'Back to your reservation' : 'Back to dining'}
		</a>
		<h1 class="storefront-section-title ink-heading ledger-display mt-3 text-3xl sm:text-4xl">{heading}</h1>
		<p class="storefront-section-lede text-[0.9375rem] leading-relaxed">{lede}</p>

		{#if !isPre && data.venues.length > 1}
			<form bind:this={venueForm} method="GET" class="mt-6">
				<Label for="orVenue" class="ledger-label">From</Label>
				<select id="orVenue" name="venue" class="ledger-field mt-1 w-full sm:w-72" onchange={() => venueForm?.requestSubmit()}>
					{#each data.venues as v (v.id)}<option value={v.id} selected={v.id === data.venue.id}>{v.title}</option>{/each}
				</select>
			</form>
		{/if}

		<div class="mt-8 grid gap-10 lg:grid-cols-[1fr_21rem]">
			<!-- Menu -->
			<div>
				{#if data.menu.categories.length > 1}
					<div class="flex flex-wrap gap-2" role="tablist" aria-label="Menu sections">
						<button type="button" role="tab" aria-selected={category === 'all'} class="order-chip" class:is-on={category === 'all'} onclick={() => (category = 'all')}>All</button>
						{#each data.menu.categories as c (c.id)}
							<button type="button" role="tab" aria-selected={category === c.id} class="order-chip" class:is-on={category === c.id} onclick={() => (category = c.id)}>{c.name}</button>
						{/each}
					</div>
				{/if}

				{#each sections as section (section.id)}
					{#if section.name}<h2 class="storefront-menu-category ledger-display">{section.name}</h2>{/if}
					<ul>
						{#each section.items as item (item.id)}
							{@const open = editing?.item.id === item.id}
							<li class="order-dish" class:is-sold-out={!item.isAvailable}>
								<button type="button" class="order-row" disabled={!item.isAvailable} aria-expanded={open} onclick={() => startItem(item)}>
									<span class="min-w-0 flex-1">
										<span class="storefront-menu-name">{item.name}{#if !item.isAvailable}<span class="storefront-menu-flag">Sold out today</span>{/if}</span>
										{#if item.description}<span class="storefront-menu-desc block">{item.description}</span>{/if}
									</span>
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
				{/each}
			</div>

			<!-- Your order -->
			<aside id="order" class="order-ledger" aria-label="Your order">
				<h2 class="ledger-label border-b border-[var(--ledger-ink)] pb-2">Your order</h2>
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
						<span>Total <span class="text-xs text-[var(--ledger-ink-muted)]">VAT included</span></span>
						<span class="ledger-data text-lg">{peso(total)}</span>
					</div>
				{/if}
			</aside>
		</div>

		<!-- Details and payment -->
		<form
			method="POST"
			action="?/place"
			class="mt-12 max-w-3xl space-y-10"
			use:enhance={() => {
				submitting = true;
				return async ({ result, update }) => {
					if (result.type === 'redirect') {
						window.location.href = result.location; // PayMongo or the order page: a full navigation
						return;
					}
					submitting = false;
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="payload" value={payload} />

			<fieldset>
				<legend class="ledger-label w-full border-b border-[var(--ledger-rule)] pb-2">{isPre ? 'Served at your table' : 'Pickup time'}</legend>
				{#if isPre}
					<p class="mt-4 text-[0.9375rem]">
						<span class="ledger-data">{dayLabel(data.reservation!.local.date)}, {clock(data.reservation!.local.time)}</span>
						at {data.reservation!.venueTitle}, as booked.
					</p>
				{:else if days.length === 0}
					<p class="mt-4 text-sm text-[var(--ledger-ink-muted)]">There are no pickup times left. Please try again tomorrow.</p>
				{:else}
					<div class="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Pickup day">
						{#each days as d (d.date)}
							<button type="button" role="tab" aria-selected={pickDate === d.date} class="order-chip" class:is-on={pickDate === d.date} onclick={() => { pickDate = d.date; pickTime = ''; }}>{dayLabel(d.date)}</button>
						{/each}
					</div>
					<div class="dining-slot-grid mt-4" role="radiogroup" aria-label="Pickup times">
						{#each timesForDay as t (t)}
							<label class="dining-slot">
								<input type="radio" name="pickupTime" value={t} checked={pickTime === t} onchange={() => (pickTime = t)} />
								<span class="ledger-data">{clock(t)}</span>
							</label>
						{/each}
					</div>
					{#if data.cfg.pickupNote}<p class="mt-3 text-sm text-[var(--ledger-ink-muted)]">{data.cfg.pickupNote}</p>{/if}
				{/if}
			</fieldset>

			<fieldset class="space-y-5">
				<legend class="ledger-label w-full border-b border-[var(--ledger-rule)] pb-2">Your details</legend>
				<div class="absolute -left-[9999px]" aria-hidden="true">
					<label>Website <input type="text" tabindex="-1" autocomplete="off" bind:value={honeypot} /></label>
				</div>
				<div>
					<Label for="orName" class="ledger-label">Name</Label>
					<Input id="orName" bind:value={guestName} required autocomplete="name" class="ledger-field mt-1" />
				</div>
				<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
					<div>
						<Label for="orPhone" class="ledger-label">Mobile number</Label>
						<Input id="orPhone" type="tel" bind:value={guestPhone} required autocomplete="tel" inputmode="tel" class="ledger-field mt-1" />
						<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">So we can reach you about your order.</p>
					</div>
					<div>
						<Label for="orEmail" class="ledger-label">Email (optional)</Label>
						<Input id="orEmail" type="email" bind:value={guestEmail} autocomplete="email" inputmode="email" class="ledger-field mt-1" />
						<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">We email your order code and tell you when it is ready.</p>
					</div>
				</div>
				<div>
					<Label for="orNote" class="ledger-label">Anything we should know (optional)</Label>
					<Textarea id="orNote" bind:value={remarks} rows={2} maxlength={500} placeholder="Allergies, packaging, cutlery" class="ledger-field mt-1" />
				</div>
			</fieldset>

			<fieldset>
				<legend class="ledger-label w-full border-b border-[var(--ledger-rule)] pb-2">How you will pay</legend>
				<div class="mt-4 space-y-2" role="radiogroup" aria-label="Payment">
					{#if data.cfg.canPayOnline}
						<label class="order-pay-option">
							<input type="radio" name="payChoice" value="online" checked={payMode === 'online'} onchange={() => (payMode = 'online')} />
							<span>
								<span class="storefront-menu-name block">Pay now online</span>
								<span class="storefront-menu-desc block">GCash, Maya, card or QR Ph. Your order goes to the kitchen as soon as payment is confirmed.</span>
							</span>
						</label>
					{/if}
					{#if data.cfg.canPayAtVenue}
						<label class="order-pay-option">
							<input type="radio" name="payChoice" value="venue" checked={payMode === 'venue'} onchange={() => (payMode = 'venue')} />
							<span>
								<span class="storefront-menu-name block">Pay at the restaurant</span>
								<span class="storefront-menu-desc block">Your order goes straight to the kitchen. Pay when you {isPre ? 'dine' : 'collect it'}.</span>
							</span>
						</label>
					{/if}
				</div>
			</fieldset>

			{#if form?.error}
				<p role="alert" class="border-t border-[var(--ledger-danger)] pt-3 text-sm text-[var(--ledger-danger)]">{form.error}</p>
			{/if}

			<div class="flex flex-wrap items-center gap-4">
				<button type="submit" class="ledger-btn-primary min-h-12 w-full sm:w-auto" disabled={!ready || submitting}>
					{submitting ? 'One moment…' : payMode === 'online' ? `Pay ${peso(total)} now` : `Place order · ${peso(total)}`}
				</button>
				<p class="text-xs text-[var(--ledger-ink-muted)]">VAT included. {payMode === 'online' ? 'You will pay on PayMongo’s secure page.' : 'No payment is taken now.'}</p>
			</div>
		</form>
	</div>
</section>

{#if cart.length > 0}
	<a href="#order" class="order-pill lg:hidden" aria-label="View your order, {itemCount} items, {peso(total)}">
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
