<script lang="ts">
	import { enhance } from '$app/forms';
import { pushState } from '$app/navigation';
import { tick, untrack } from 'svelte';
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
	const dishesTotal = $derived(sumLines(priced).totalCentavos);

	// ---- pickup or delivery ---------------------------------------------------------
	// Only a takeaway order can be delivered. The fee shown here is the venue's own setting; the
	// server reads it again when the order is placed and never takes it from this page.
	const canDeliver = $derived(!isPre && data.cfg.deliveryEnabled);
	let fulfilment = $state<'pickup' | 'delivery'>('pickup');
	let deliveryAddress = $state('');
	const delivering = $derived(canDeliver && fulfilment === 'delivery');
	const deliveryFee = $derived(delivering ? data.cfg.deliveryFeeCentavos : 0);
	const total = $derived(dishesTotal + deliveryFee);
	const itemCount = $derived(cart.reduce((n, l) => n + l.quantity, 0));

	// ---- pickup time (computed here, re-checked by the server) ----------------------
	const days = $derived.by(() => {
		const now = new Date(data.nowIso);
		const today = localParts(now, tz).date;
		const cfg = { seatingOpen: data.cfg.orderOpen, lastSeating: data.cfg.orderClose, slotMinutes: 15, turnMinutes: 15, minNoticeMinutes: data.cfg.prepMinutes, advanceDays: 7, maxPartySize: 1 };
		return Array.from({ length: Math.min(7, data.cfg.orderAheadDays + 1) }, (_, i) => addDays(today, i))
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
	// Orders for another day are taken by phone; show the venue's number wherever the page runs out.
	const callPhone = $derived(page.data.branding?.contactPhone ?? null);
	const sameDayOnly = $derived(data.cfg.orderAheadDays === 0);

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

	const ready = $derived(
		cart.length > 0 &&
			guestName.trim().length > 0 &&
			guestPhone.trim().length >= 5 &&
			(isPre || (pickDate && pickTime)) &&
			(!delivering || deliveryAddress.trim().length >= 8)
	);
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
			fulfilment: delivering ? 'delivery' : 'pickup',
			deliveryAddress: delivering ? deliveryAddress.trim() : undefined,
			website: honeypot || undefined,
			lines: cart.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, remarks: l.remarks || undefined, addonIds: l.addons.map((a) => a.id) }))
		})
	);

	// ---- the steps ------------------------------------------------------------------
	// 1 Order · 2 Review · 3 Pickup/Delivery + time · 4 Details & pay. A pre-order has no step 3: its
	// time is the booking's. The step lives in the history state, so the browser's Back button goes to
	// the previous step instead of leaving the page, and a reload starts again at step 1 (the cart is
	// kept in sessionStorage).
	const STEPS = $derived(
		isPre
			? [{ n: 1, label: 'Order' }, { n: 2, label: 'Review' }, { n: 4, label: 'Details & pay' }]
			: [{ n: 1, label: 'Order' }, { n: 2, label: 'Review' }, { n: 3, label: delivering ? 'Delivery' : 'Pickup' }, { n: 4, label: 'Details & pay' }]
	);
	const step = $derived.by(() => {
		if (cart.length === 0) return 1; // nothing to review yet
		const s = page.state.step ?? 1;
		return isPre && s === 3 ? 4 : s;
	});
	const stepIndex = $derived(Math.max(0, STEPS.findIndex((s) => s.n === step)));
	function go(n: number) {
		pushState('', { step: n });
		tick().then(() => document.getElementById('order-steps')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
	}
	const next = () => STEPS[stepIndex + 1] && go(STEPS[stepIndex + 1]!.n);
	const back = () => STEPS[stepIndex - 1] && go(STEPS[stepIndex - 1]!.n);

	// Today has run out of times (or ordering has closed): say so before anyone builds a cart.
	const closedToday = $derived(!isPre && days.length === 0);
	const whenOk = $derived(isPre || (!!pickDate && !!pickTime && (!delivering || deliveryAddress.trim().length >= 8)));
	const detailsOk = $derived(guestName.trim().length > 0 && guestPhone.trim().length >= 5);

	// A rejected time or address sends the guest back to the step that owns it.
	$effect(() => {
		const e = form?.error;
		if (e && !isPre && /time|pickup|deliver|address|closed/i.test(e)) {
			untrack(() => {
				if (step !== 3) go(3);
			});
		}
	});

	// ---- keep the cart across a reload ----------------------------------------------
	const CART_KEY = $derived(`mmhotel:dining-cart:${hotel.slug}:${data.venue.id}:${data.reservation?.code ?? ''}`);
	let restored = false;
	$effect(() => {
		if (restored || typeof sessionStorage === 'undefined') return;
		restored = true;
		try {
			const saved = JSON.parse(sessionStorage.getItem(CART_KEY) ?? '[]') as { itemId: string; addons: CartLine['addons']; quantity: number; remarks: string }[];
			for (const s of saved) {
				const item = data.menu.items.find((i) => i.id === s.itemId && i.isAvailable);
				if (item) cart.push({ key: ++keySeq, item, addons: s.addons ?? [], quantity: Math.min(50, Math.max(1, s.quantity)), remarks: s.remarks ?? '' });
			}
		} catch {
			/* an unreadable saved cart is simply ignored */
		}
	});
	$effect(() => {
		const snapshot = cart.map((l) => ({ itemId: l.item.id, addons: l.addons, quantity: l.quantity, remarks: l.remarks }));
		if (!restored || typeof sessionStorage === 'undefined') return;
		try {
			sessionStorage.setItem(CART_KEY, JSON.stringify(snapshot));
		} catch {
			/* storage full or unavailable: the cart still works for this visit */
		}
	});

	const heading = $derived(isPre ? 'Pre-order for your table' : 'Order online');
	const lede = $derived(
		isPre
			? `Choose your dishes now and they will be ready when you sit down on ${longDay(data.reservation!.local.date)} at ${clock(data.reservation!.local.time)}.`
			: `Choose your dishes, then ${canDeliver ? 'pick them up or have them delivered' : 'a pickup time'}. Times run ${clock(data.cfg.orderOpen)} to ${clock(data.cfg.orderClose)}, at least ${data.cfg.prepMinutes} minutes ahead.${data.cfg.orderAheadDays === 0 ? ' Online orders are for today only; to order for another day, please call us.' : ''}`
	);
	let venueForm: HTMLFormElement | undefined = $state();
</script>

{#snippet orderLines(editable: boolean)}
<ul>
						{#each cart as l, i (l.key)}
							<li class="order-line">
								<div class="min-w-0 flex-1">
									<p class="storefront-menu-name">{l.item.name}</p>
									{#each l.addons as a (a.id)}<p class="storefront-menu-desc">+ {a.name}</p>{/each}
									{#if l.remarks}<p class="storefront-menu-desc italic">“{l.remarks}”</p>{/if}
									{#if editable}
<div class="order-stepper mt-1.5" role="group" aria-label="Quantity of {l.item.name}">
										<button type="button" aria-label="Fewer" onclick={() => (l.quantity > 1 ? l.quantity-- : cart.splice(i, 1))}><MinusIcon class="size-3.5" /></button>
										<span class="ledger-data">{l.quantity}</span>
										<button type="button" aria-label="More" onclick={() => l.quantity < 50 && l.quantity++}><PlusIcon class="size-3.5" /></button>
									</div>{:else}<p class="storefront-menu-desc">× {l.quantity}</p>{/if}
								</div>
								<span class="ledger-data">{peso(priced[i]!.lineTotalCentavos)}</span>
								{#if editable}<button type="button" class="order-remove" aria-label="Remove {l.item.name}" onclick={() => cart.splice(i, 1)}><XIcon class="size-3.5" /></button>{/if}
							</li>
						{/each}
					</ul>
{/snippet}

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

		{#if !isPre && data.venues.length > 1 && step === 1}
			<form bind:this={venueForm} method="GET" class="mt-6">
				<Label for="orVenue" class="ledger-label">From</Label>
				<select id="orVenue" name="venue" class="ledger-field mt-1 w-full sm:w-72" onchange={() => venueForm?.requestSubmit()}>
					{#each data.venues as v (v.id)}<option value={v.id} selected={v.id === data.venue.id}>{v.title}</option>{/each}
				</select>
			</form>
		{/if}

		<nav id="order-steps" class="mt-8" aria-label="Order steps">
<p class="ledger-step lg:hidden" aria-live="polite">STEP {stepIndex + 1} OF {STEPS.length} — {STEPS[stepIndex]!.label.toUpperCase()}</p>
<ol class="ledger-stepper-horizontal hidden lg:flex">
{#each STEPS as s, i (s.n)}
<li class="ledger-stepper-node {i === stepIndex ? "is-active" : ""} {i < stepIndex ? "is-done" : ""}" aria-current={i === stepIndex ? "step" : undefined}>
{#if i < stepIndex}
<button type="button" class="flex items-center gap-2" onclick={() => go(s.n)}>
<span class="ledger-stepper-node-circle ledger-data">{(i + 1).toString().padStart(2, "0")}</span>
<span class="ledger-stepper-node-label">{s.label}</span>
</button>
{:else}
<span class="ledger-stepper-node-circle ledger-data">{(i + 1).toString().padStart(2, "0")}</span>
<span class="ledger-stepper-node-label">{s.label}</span>
{/if}
</li>
{/each}
</ol>
</nav>

{#if closedToday}
<p role="status" class="mt-6 border-l-2 border-[var(--ledger-rule)] pl-3 text-sm">
Online ordering is closed for today.
{#if callPhone} To order for another day, please call <a class="underline" href="tel:{callPhone}">{callPhone}</a>.{/if}
</p>
{/if}

<div class="mt-8 grid gap-10 lg:grid-cols-[1fr_21rem]">
			<!-- The current step -->
<div>
{#if step === 1}
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
				{/each}
			{:else if step === 2}
<section aria-labelledby="review-h">
<h2 id="review-h" class="ledger-label border-b border-[var(--ledger-ink)] pb-2">Review your order</h2>
{#if cart.length === 0}
<p class="mt-4 text-sm text-[var(--ledger-ink-muted)]">Your order is empty.</p>
{:else}
<div class="order-ledger mt-2">
{@render orderLines(true)}
<div class="order-total">
<span>Subtotal <span class="text-xs text-[var(--ledger-ink-muted)]">VAT included</span></span>
<span class="ledger-data text-lg">{peso(dishesTotal)}</span>
</div>
</div>
<p class="mt-3 text-xs text-[var(--ledger-ink-muted)]">{isPre ? "Your order is served at your table time." : canDeliver ? "Next you choose pickup or delivery and a time." : "Next you choose a pickup time."}</p>
{/if}
<div class="mt-6 flex flex-wrap items-center gap-3">
<button type="button" class="ledger-btn-ghost min-h-12 px-5" onclick={back}>← Back to menu</button>
<button type="button" class="ledger-btn-primary min-h-12 px-6" disabled={cart.length === 0 || closedToday} onclick={next}>Continue</button>
</div>
</section>
{/if}

{#if step >= 3}
<div id="order-step">
<form
			method="POST"
			action="?/place"
			class="space-y-10"
			use:enhance={() => {
				submitting = true;
				return async ({ result, update }) => {
					if (result.type === 'redirect') {
						try {
							sessionStorage.removeItem(CART_KEY);
						} catch {
							/* nothing to clear */
						}
						window.location.href = result.location; // PayMongo or the order page: a full navigation
						return;
					}
					submitting = false;
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="payload" value={payload} />

			{#if step === 3 && !isPre}
				<fieldset>
					<legend class="ledger-label w-full border-b border-[var(--ledger-rule)] pb-2">Pickup or delivery</legend>
					<div class="mt-4 space-y-2" role="radiogroup" aria-label="Pickup or delivery">
						<label class="order-pay-option">
							<input type="radio" name="fulfilmentChoice" value="pickup" checked={fulfilment === 'pickup'} onchange={() => (fulfilment = 'pickup')} />
							<span>
								<span class="storefront-menu-name block">Pickup</span>
								<span class="storefront-menu-desc block">Collect it at the restaurant. No delivery fee.</span>
							</span>
						</label>
						{#if data.cfg.deliveryEnabled}
<label class="order-pay-option">
							<input type="radio" name="fulfilmentChoice" value="delivery" checked={fulfilment === 'delivery'} onchange={() => (fulfilment = 'delivery')} />
							<span>
								<span class="storefront-menu-name block">Delivered by our rider{data.cfg.deliveryFeeCentavos > 0 ? ` · ${peso(data.cfg.deliveryFeeCentavos)}` : ' · free'}</span>
								<span class="storefront-menu-desc block">Our rider brings it to your address. The fee is added to your total, VAT included.</span>
							</span>
						</label>
{:else}
<p class="text-sm text-[var(--ledger-ink-muted)]">This venue does not deliver online orders, so it is for pickup.</p>
{/if}
					</div>
					{#if delivering}
						<div class="mt-4">
							<Label for="orAddress" class="ledger-label">Delivery address</Label>
							<Textarea id="orAddress" bind:value={deliveryAddress} rows={2} maxlength={300} required placeholder="Street, barangay, city, and a landmark if you can" class="ledger-field mt-1" />
						</div>
					{/if}
				</fieldset>
			{/if}

			{#if step === 3}
<fieldset>
<legend class="ledger-label w-full border-b border-[var(--ledger-rule)] pb-2">{isPre ? 'Served at your table' : delivering ? 'Delivery time' : 'Pickup time'}</legend>
				{#if isPre}
					<p class="mt-4 text-[0.9375rem]">
						<span class="ledger-data">{dayLabel(data.reservation!.local.date)}, {clock(data.reservation!.local.time)}</span>
						at {data.reservation!.venueTitle}, as booked.
					</p>
				{:else if days.length === 0}
					<p class="mt-4 text-sm text-[var(--ledger-ink-muted)]">
						{sameDayOnly ? 'Online ordering is closed for today.' : 'There are no pickup times left.'}
						{#if callPhone}To order for another day, please call <a class="underline" href="tel:{callPhone}">{callPhone}</a>.{:else}Please try again tomorrow.{/if}
					</p>
				{:else}
					{#if days.length > 1}
						<div class="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Pickup day">
							{#each days as d (d.date)}
								<button type="button" role="tab" aria-selected={pickDate === d.date} class="order-chip" class:is-on={pickDate === d.date} onclick={() => { pickDate = d.date; pickTime = ''; }}>{dayLabel(d.date)}</button>
							{/each}
						</div>
					{:else}
						<p class="mt-4 text-sm">Today, <span class="ledger-data">{dayLabel(days[0]!.date)}</span></p>
					{/if}
					<div class="dining-slot-grid mt-4" role="radiogroup" aria-label="Pickup times">
						{#each timesForDay as t (t)}
							<label class="dining-slot">
								<input type="radio" name="pickupTime" value={t} checked={pickTime === t} onchange={() => (pickTime = t)} />
								<span class="ledger-data">{clock(t)}</span>
							</label>
						{/each}
					</div>
					{#if data.cfg.pickupNote && !delivering}<p class="mt-3 text-sm text-[var(--ledger-ink-muted)]">{data.cfg.pickupNote}</p>{/if}
				{/if}
			</fieldset>
<div class="flex flex-wrap items-center gap-3">
<button type="button" class="ledger-btn-ghost min-h-12 px-5" onclick={back}>← Back</button>
<button type="button" class="ledger-btn-primary min-h-12 px-6" disabled={!whenOk || closedToday} onclick={next}>Continue</button>
{#if form?.error}<p role="alert" class="w-full text-sm text-[var(--ledger-danger)]">{form.error}</p>{/if}{#if !whenOk}<p class="text-xs text-[var(--ledger-ink-muted)]">{delivering && deliveryAddress.trim().length < 8 ? "Enter the address to deliver to, then choose a time." : "Choose a time to continue."}</p>{/if}
</div>
{/if}

			{#if step === 4}
<section aria-label="Your order at a glance">
<h2 class="ledger-label w-full border-b border-[var(--ledger-rule)] pb-2">Almost there</h2>
<dl class="mt-3 divide-y divide-[var(--ledger-rule)] text-sm">
<div class="flex items-baseline justify-between gap-4 py-2"><dt class="ledger-label">Order</dt><dd class="text-right">{itemCount} {itemCount === 1 ? "item" : "items"} · {peso(dishesTotal)} <button type="button" class="ml-2 underline underline-offset-2" onclick={() => go(2)}>Change</button></dd></div>
{#if isPre}
<div class="flex items-baseline justify-between gap-4 py-2"><dt class="ledger-label">At your table</dt><dd class="text-right">{dayLabel(data.reservation.local.date)}, {clock(data.reservation.local.time)}</dd></div>
{:else}
<div class="flex items-baseline justify-between gap-4 py-2"><dt class="ledger-label">{delivering ? "Delivery" : "Pickup"}</dt><dd class="text-right">{pickDate ? dayLabel(pickDate) : ""}{pickTime ? `, ${clock(pickTime)}` : ""} <button type="button" class="ml-2 underline underline-offset-2" onclick={() => go(3)}>Change</button></dd></div>
{#if delivering}<div class="flex items-baseline justify-between gap-4 py-2"><dt class="ledger-label">Deliver to</dt><dd class="text-right">{deliveryAddress}</dd></div>{/if}
{/if}
</dl>
</section>

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
								<span class="storefront-menu-desc block">Your order goes straight to the kitchen. Pay when you {isPre ? 'dine' : delivering ? 'receive it' : 'collect it'}.</span>
							</span>
						</label>
					{/if}
				</div>
			</fieldset>

			{#if form?.error}
				<p role="alert" class="border-t border-[var(--ledger-danger)] pt-3 text-sm text-[var(--ledger-danger)]">{form.error}</p>
			{/if}

			<div class="flex flex-wrap items-center gap-4">
				<button type="submit" class="ledger-btn-primary min-h-12 w-full sm:w-auto" disabled={!ready || !detailsOk || submitting}>
					{submitting ? 'One moment…' : payMode === 'online' ? `Pay ${peso(total)} now` : `Place order · ${peso(total)}`}
				</button>
				<p class="text-xs text-[var(--ledger-ink-muted)]">VAT included. {payMode === 'online' ? 'You will pay on PayMongo’s secure page.' : 'No payment is taken now.'}</p>
			</div>
		
<div>
<button type="button" class="ledger-btn-ghost min-h-12 px-5" onclick={back}>← Back</button>
</div>
{/if}
</form>
</div>
{/if}
</div>

<!-- Your order -->
			<aside id="order" class="order-ledger" aria-label="Your order">
				<h2 class="ledger-label border-b border-[var(--ledger-ink)] pb-2">Your order</h2>
				{#if cart.length === 0}
					<p class="mt-4 text-sm text-[var(--ledger-ink-muted)]">Nothing yet. Pick a dish from the menu.</p>
				{:else}
					{@render orderLines(step === 1)}
					{#if deliveryFee > 0}
						<div class="order-line">
							<div class="min-w-0 flex-1"><p class="storefront-menu-name">Delivery fee</p></div>
							<span class="ledger-data">{peso(deliveryFee)}</span>
						</div>
					{/if}
					<div class="order-total">
						<span>Total <span class="text-xs text-[var(--ledger-ink-muted)]">VAT included</span></span>
						<span class="ledger-data text-lg">{peso(total)}</span>
</div>
{#if step === 1}
<button type="button" class="ledger-btn-primary mt-4 min-h-12 w-full" disabled={closedToday} onclick={next}>Review order · {peso(total)}</button>
{/if}
{/if}
</aside>
		</div>

		
	</div>
</section>

{#if cart.length > 0 && step === 1}
<button type="button" onclick={() => (closedToday ? undefined : go(2))} class="order-pill lg:hidden" aria-label="View your order, {itemCount} items, {peso(total)}">
		<ShoppingBagIcon class="size-4" aria-hidden="true" />
		<span>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
		<span class="ledger-data">{peso(total)}</span>
	</button>
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
