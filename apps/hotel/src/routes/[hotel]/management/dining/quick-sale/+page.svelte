<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	// Dining's own till, not Finance → Shifts: a dining account has no `finance:read`.
	const shiftsHref = $derived(`/${page.params.hotel}/management/dining/drawer`);

	interface CartLine {
		amenityItemId: string | null;
		description: string;
		quantity: number;
		unitPriceCentavos: number;
	}

	type CatalogItem = PageData['items'][number];

	let cart = $state<CartLine[]>([]);
	// Local, appended to as staff add custom items — see addCustomItem's
	// use:enhance below — so a newly created catalog item is tappable and
	// shows up in autosuggest immediately, without a full page reload.
	let catalogItems = $state<CatalogItem[]>(data.items);
	// `room` is not a payment method — nothing is tendered. It posts the cart to a folio instead,
	// through its own form below.
	let method = $state<(typeof data.methods)[number] | 'room'>('cash');
	let tenderedInput = $state('');
	let customName = $state('');
	let customPrice = $state('');
	let customSubmitting = $state(false);
	let activeCategory = $state<string | null>(null);
	let submitting = $state(false);

	// Per-device convenience, not a real account setting — deliberately
	// localStorage, not a DB column. "Silent" is the closest the web platform
	// allows: `window.print()` still opens the browser's own print dialog (there
	// is no dialog-free print API), this just skips the manual "Print receipt"
	// click and fires it the instant a sale completes.
	function loadSilentPrintPref(): boolean {
		if (typeof localStorage === 'undefined') return false;
		try {
			return localStorage.getItem('quickSaleSilentPrint') === '1';
		} catch {
			return false;
		}
	}
	let silentPrint = $state(loadSilentPrintPref());
	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem('quickSaleSilentPrint', silentPrint ? '1' : '0');
		} catch {
			// Private-mode/blocked storage — the toggle just won't persist across visits.
		}
	});

	// Held after a successful charge, until "New sale" — swaps the cart panel
	// for a print/next-transaction confirmation instead of just toasting and
	// silently resetting, since a completed sale is the moment staff need to
	// hand over (or print) a receipt. Set imperatively from the submit's own
	// result (not a $effect watching the `form` prop) — `form` stays populated
	// after the first successful submit, and clearing the cart afterward
	// (which "New sale" does) changes `total`, which an effect reading `total`
	// would re-run on, silently re-showing the confirmation it was just told
	// to dismiss.
	let completed = $state<{ saleId: string; totalCentavos: number; changeCentavos: number } | null>(null);

	const total = $derived(cart.reduce((s, l) => s + l.unitPriceCentavos * l.quantity, 0));
	const tenderedCentavos = $derived(method === 'cash' ? Math.round((parseFloat(tenderedInput) || 0) * 100) : null);
	const change = $derived(tenderedCentavos != null ? Math.max(0, tenderedCentavos - total) : 0);
	const cashShort = $derived(method === 'cash' && (tenderedCentavos == null || tenderedCentavos < total));
	const categories = $derived([...new Set(catalogItems.map((i) => i.category).filter((c): c is string => !!c))]);
	const visibleItems = $derived(activeCategory ? catalogItems.filter((i) => i.category === activeCategory) : catalogItems);
	// Existing items matching what's being typed — pick one instead of creating
	// a near-duplicate. Exact substring, case-insensitive; capped so it never
	// grows into its own scroll region.
	const customSuggestions = $derived(
		customName.trim().length > 0
			? catalogItems.filter((i) => i.name.toLowerCase().includes(customName.trim().toLowerCase())).slice(0, 6)
			: []
	);

	function addItem(item: CatalogItem) {
		const existing = cart.find((l) => l.amenityItemId === item.id);
		if (existing) existing.quantity++;
		else cart.push({ amenityItemId: item.id, description: item.name, quantity: 1, unitPriceCentavos: item.priceCentavos });
	}

	function pickSuggestion(item: CatalogItem) {
		addItem(item);
		customName = '';
		customPrice = '';
	}

	function inc(line: CartLine) {
		line.quantity++;
	}
	function dec(i: number) {
		const line = cart[i];
		if (!line) return;
		if (line.quantity > 1) line.quantity--;
		else cart.splice(i, 1);
	}
	function removeLine(i: number) {
		cart.splice(i, 1);
	}
	function newSale() {
		completed = null;
		cart = [];
		tenderedInput = '';
	}

	let cartJson = $derived(JSON.stringify({ method, lines: cart, tenderedCentavos }));
	// "Room" posts to a folio, not through the till, so it sends names and prices — a bill shows
	// what the guest bought, not catalog ids.
	let roomCartJson = $derived(
		JSON.stringify({
			lines: cart.map((l) => ({
				amenityItemId: l.amenityItemId,
				description: l.description,
				quantity: l.quantity,
				unitPriceCentavos: l.unitPriceCentavos
			}))
		})
	);
	let guestSearch = $state('');
	let bookingId = $state('');
	const inHouseMatches = $derived(
		data.inHouse.filter((g) =>
			`${g.roomNumber} ${g.guestName} ${g.bookingCode}`.toLowerCase().includes(guestSearch.trim().toLowerCase())
		)
	);
	const chosenGuest = $derived(data.inHouse.find((g) => g.bookingId === bookingId) ?? null);

	const fmtTime = (iso: string | Date) =>
		new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
	function shiftLabel(s: PageData['shifts'][number]): string {
		const start = fmtTime(s.openedAt);
		if (s.status === 'open') return `${start} — now open`;
		return `${start} – ${s.closedAt ? fmtTime(s.closedAt) : '?'}`;
	}

	// A read-only "which shift's sales am I looking at" view — separate from
	// whichever shift is actually open, which is what a new sale posts
	// against regardless of what's being viewed here.
	function viewShift(shiftId: string) {
		const url = new URL(page.url);
		if (shiftId === data.openShiftId) url.searchParams.delete('shiftId');
		else url.searchParams.set('shiftId', shiftId);
		goto(url, { keepFocus: true, noScroll: true });
	}
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">Quick sale</h1>
	<p class="mb-5 text-sm text-ink-muted">
		Sell something with no dish behind it — corkage, a bottle of water, anything off-menu. It
		rings into {data.drawerName ?? 'the dining drawer'} and counts as dining's own takings. A
		dish goes through <a href="/{page.params.hotel}/management/dining/orders" class="underline">Orders</a>
		instead, so the kitchen sees it.
	</p>

	{#if data.requireOpenShiftForCashPayment && !data.hasOpenShift}
		<div class="mb-5 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
			<CircleAlertIcon class="size-4 shrink-0" />
			<p>
				The dining drawer is closed. Cash needs an open shift — open one on
				<a href={shiftsHref} class="underline">Drawer</a> first, or choose a non-cash method.
			</p>
		</div>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[1fr_380px]">
		<!-- Catalog -->
		<section class="rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
			{#if categories.length > 0}
				<div class="mb-4 flex flex-wrap gap-2">
					<button
						type="button"
						onclick={() => (activeCategory = null)}
						class="rounded-full px-3 py-1.5 text-sm font-medium transition {activeCategory === null
							? 'bg-brand text-brand-ink'
							: 'bg-surface text-ink-muted hover:text-ink'}"
					>
						All
					</button>
					{#each categories as c (c)}
						<button
							type="button"
							onclick={() => (activeCategory = c)}
							class="rounded-full px-3 py-1.5 text-sm font-medium transition {activeCategory === c
								? 'bg-brand text-brand-ink'
								: 'bg-surface text-ink-muted hover:text-ink'}"
						>
							{c}
						</button>
					{/each}
				</div>
			{/if}

			{#if catalogItems.length === 0}
				<p class="text-sm text-ink-muted">No sellable items yet — add some under Settings → Sellable items.</p>
			{:else}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
					{#each visibleItems as item (item.id)}
						<button
							type="button"
							onclick={() => addItem(item)}
							class="flex min-h-24 flex-col justify-between rounded-xl border border-border bg-surface p-3 text-left shadow-sm transition hover:border-brand/50 hover:shadow active:scale-[0.97]"
						>
							<span class="text-sm font-medium leading-tight text-ink">{item.name}</span>
							<span class="text-lg font-semibold text-ink">{peso(item.priceCentavos)}</span>
						</button>
					{/each}
				</div>
			{/if}

			<div class="mt-5 border-t border-border pt-4">
				<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Custom item</h3>
				<p class="mb-2 text-xs text-ink-muted">
					Not in the catalog? Type it once — it's saved for next time too.
				</p>
				<form
					method="POST"
					action="?/addCustomItem"
					use:enhance={() => {
						customSubmitting = true;
						return async ({ result, update }) => {
							customSubmitting = false;
							if (result.type === 'success' && result.data && 'item' in result.data) {
								const item = result.data.item as CatalogItem;
								const matchedExisting = result.data.matchedExisting as boolean;
								if (!catalogItems.some((i) => i.id === item.id)) catalogItems.push(item);
								addItem(item);
								if (matchedExisting) toast.success(`Matched existing item "${item.name}" — using its catalog price.`);
								customName = '';
								customPrice = '';
								await update({ reset: false });
							} else if (result.type === 'failure' && result.data && 'error' in result.data) {
								toast.error(result.data.error as string);
								await update({ reset: false });
							} else {
								await update();
							}
						};
					}}
					class="flex gap-2"
				>
					<div class="relative flex-1">
						<Input name="name" placeholder="Name" autocomplete="off" bind:value={customName} />
						{#if customSuggestions.length > 0}
							<div class="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-surface shadow-md">
								{#each customSuggestions as s (s.id)}
									<button
										type="button"
										onclick={() => pickSuggestion(s)}
										class="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-2"
									>
										<span class="truncate text-ink">{s.name}</span>
										<span class="ml-2 shrink-0 text-ink-muted">{peso(s.priceCentavos)}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
					<input type="hidden" name="priceCentavos" value={Math.round((parseFloat(customPrice) || 0) * 100)} />
					<Input placeholder="Price" type="number" step="0.01" min="0" bind:value={customPrice} class="w-28" />
					<Button type="submit" variant="outline" disabled={customSubmitting}>Add</Button>
				</form>
			</div>
		</section>

		<!-- Cart -->
		<section class="h-fit rounded-xl border border-border bg-surface-2 p-4 sm:sticky sm:top-4 sm:p-5">
			{#if completed}
				<div class="flex flex-col items-center gap-3 py-6 text-center">
					<CircleCheckIcon class="size-10 text-ok" />
					<div>
						<p class="text-lg font-semibold text-ink">Sale recorded</p>
						<p class="text-sm text-ink-muted">{peso(completed.totalCentavos)} charged</p>
						{#if completed.changeCentavos > 0}
							<p class="mt-1 text-base font-semibold text-ink">Change due: {peso(completed.changeCentavos)}</p>
						{/if}
					</div>
					<div class="mt-2 flex w-full flex-col gap-2">
						<a
							href="/{page.params.hotel}/print/sale-receipt/{completed.saleId}"
							target="_blank"
							rel="noopener"
							class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-brand-ink hover:opacity-90"
						>
							<PrinterIcon class="size-4" /> Print receipt (80mm)
						</a>
						<Button type="button" variant="outline" class="w-full" onclick={newSale}>New sale</Button>
					</div>
				</div>
			{:else}
				<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">
					Cart {#if cart.length > 0}<span class="text-ink-muted">· {cart.length}</span>{/if}
				</h2>
				{#if cart.length === 0}
					<p class="text-sm text-ink-muted">Tap an item to add it.</p>
				{:else}
					<div class="space-y-3">
						{#each cart as line, i (i)}
							<div class="flex items-center gap-2 text-sm">
								<div class="min-w-0 flex-1">
									<p class="truncate font-medium text-ink">{line.description}</p>
									<p class="text-xs text-ink-muted">{peso(line.unitPriceCentavos)} each</p>
								</div>
								<div class="flex items-center gap-1 rounded-md border border-border">
									<button type="button" onclick={() => dec(i)} aria-label="Decrease quantity" class="flex size-7 items-center justify-center text-ink-muted hover:text-ink">
										<MinusIcon class="size-3.5" />
									</button>
									<span class="w-6 text-center font-medium text-ink">{line.quantity}</span>
									<button type="button" onclick={() => inc(line)} aria-label="Increase quantity" class="flex size-7 items-center justify-center text-ink-muted hover:text-ink">
										<PlusIcon class="size-3.5" />
									</button>
								</div>
								<span class="w-16 shrink-0 text-right font-medium text-ink">{peso(line.unitPriceCentavos * line.quantity)}</span>
								<button type="button" onclick={() => removeLine(i)} aria-label="Remove item" class="shrink-0 text-ink-muted hover:text-danger">
									<Trash2Icon class="size-4" />
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<div class="mt-4 flex items-center justify-between border-t border-border pt-3">
					<span class="text-sm font-medium text-ink">Total</span>
					<span class="text-2xl font-semibold text-ink">{peso(total)}</span>
				</div>

				<div class="mt-4 flex items-center justify-between gap-2">
					<span class="text-sm text-ink">Silent print</span>
					<button
						type="button"
						role="switch"
						aria-checked={silentPrint}
						aria-label="Silent print"
						onclick={() => (silentPrint = !silentPrint)}
						class="relative h-6 w-11 shrink-0 rounded-full transition-colors {silentPrint ? 'bg-brand' : 'bg-border'}"
					>
						<span
							class="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform {silentPrint
								? 'translate-x-5'
								: 'translate-x-0'}"
						></span>
					</button>
				</div>
				<p class="mt-1 text-xs text-ink-muted">
					Opens the print dialog for the 80mm receipt automatically when a sale completes — no manual
					"Print receipt" click. Your browser still shows its own print dialog.
				</p>

				<div class="mt-4">
					<p class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">Payment method</p>
					<div class="grid grid-cols-3 gap-1.5">
						{#each data.methods as m (m)}
							<button
								type="button"
								onclick={() => {
									method = m;
									if (m !== 'cash') tenderedInput = '';
								}}
								class="rounded-md border px-2 py-2 text-xs font-medium capitalize transition {method === m
									? 'border-brand bg-brand text-brand-ink'
									: 'border-border bg-surface text-ink-muted hover:text-ink'}"
							>
								{m.replace(/_/g, ' ')}
							</button>
						{/each}
						<button
							type="button"
							onclick={() => {
								method = 'room';
								tenderedInput = '';
							}}
							class="rounded-md border px-2 py-2 text-xs font-medium transition {method === 'room'
								? 'border-brand bg-brand text-brand-ink'
								: 'border-border bg-surface text-ink-muted hover:text-ink'}"
						>
							Room
						</button>
					</div>
				</div>

				{#if method === 'room'}
					<div class="mt-3">
						<label for="guestSearch" class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
							Charge to which guest?
						</label>
						<Input id="guestSearch" bind:value={guestSearch} placeholder="Room number or guest name" autocomplete="off" />
						<ul class="mt-2 max-h-52 divide-y divide-border overflow-y-auto rounded-lg border border-border" role="radiogroup" aria-label="Guests staying now">
							{#each inHouseMatches as g (g.bookingId)}
								<li>
									<button
										type="button"
										role="radio"
										aria-checked={bookingId === g.bookingId}
										onclick={() => (bookingId = g.bookingId)}
										class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2 {bookingId === g.bookingId ? 'bg-brand/10' : ''}"
									>
										<span class="w-14 shrink-0 font-mono font-semibold text-ink">{g.roomNumber}</span>
										<span class="min-w-0 flex-1 truncate text-ink">{g.guestName}</span>
										<span class="font-mono text-xs text-ink-muted">{g.bookingCode}</span>
									</button>
								</li>
							{:else}
								<li class="px-3 py-6 text-center text-sm text-ink-muted">
									{data.inHouse.length === 0 ? 'No guests are checked in right now.' : `No guest matches "${guestSearch}".`}
								</li>
							{/each}
						</ul>
						<p class="mt-2 text-xs text-ink-muted">
							Nothing is taken at the till — it goes on the room bill and the front desk collects it
							at check-out.
						</p>
					</div>
				{/if}

				{#if method === 'cash'}
					<div class="mt-3">
						<label for="tendered" class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-muted">
							Cash tendered
						</label>
						<Input id="tendered" type="number" step="0.01" min="0" placeholder="0.00" bind:value={tenderedInput} class="text-right text-lg" />
						<div class="mt-1.5 flex items-center justify-between text-sm">
							<span class="text-ink-muted">Change</span>
							<span class="font-semibold {cashShort ? 'text-danger' : 'text-ok'}">{peso(change)}</span>
						</div>
					</div>
				{/if}

				{#if method === 'room'}
					<form
						method="POST"
						action="?/chargeRoom"
						use:enhance={() => {
							submitting = true;
							return async ({ result, update }) => {
								submitting = false;
								if (result.type === 'success' && result.data && 'ok' in result.data) {
									toast.success(result.data.ok as string);
									cart = [];
									bookingId = '';
									guestSearch = '';
									await update({ reset: false });
								} else if (result.type === 'failure' && result.data && 'error' in result.data) {
									toast.error(result.data.error as string);
									await update({ reset: false });
								} else {
									await update();
								}
							};
						}}
						class="mt-4"
					>
						<input type="hidden" name="cart" value={roomCartJson} />
						<input type="hidden" name="bookingId" value={bookingId} />
						<Button type="submit" class="h-12 w-full text-base" disabled={cart.length === 0 || !bookingId || submitting}>
							<ReceiptIcon class="size-4" />
							{chosenGuest ? `Charge ${peso(total)} to room ${chosenGuest.roomNumber}` : 'Choose a guest'}
						</Button>
					</form>
				{:else}
				<form
					method="POST"
					action="?/sell"
					use:enhance={() => {
						submitting = true;
						const charged = { totalCentavos: total, changeCentavos: change };
						return async ({ result, update }) => {
							submitting = false;
							if (result.type === 'success' && result.data && 'saleId' in result.data) {
								const saleId = result.data.saleId as string;
								completed = { saleId, ...charged };
								cart = [];
								tenderedInput = '';
								if (silentPrint) {
									const win = window.open(
										`/${page.params.hotel}/print/sale-receipt/${saleId}?auto=1`,
										'_blank'
									);
									if (!win) toast.error('Pop-up blocked — allow pop-ups for auto-print, or use "Print receipt" below.');
								}
								await update({ reset: false });
							} else if (result.type === 'failure' && result.data && 'error' in result.data) {
								toast.error(result.data.error as string);
								await update({ reset: false });
							} else {
								await update();
							}
						};
					}}
					class="mt-4"
				>
					<input type="hidden" name="cart" value={cartJson} />
					<Button type="submit" class="h-12 w-full text-base" disabled={cart.length === 0 || cashShort || submitting}>
						<ReceiptIcon class="size-4" /> Charge {peso(total)}
					</Button>
				</form>
				{/if}
			{/if}
		</section>
	</div>

	{#if data.shifts.length === 0}
		<section class="mt-6 rounded-xl border border-border bg-surface-2 p-5">
			<h2 class="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-muted">Quick sales</h2>
			<p class="text-sm text-ink-muted">
				The dining drawer has never been opened — open a shift on
				<a href={shiftsHref} class="underline">Drawer</a> to start tracking sales here.
			</p>
		</section>
	{:else}
		<section class="mt-6 rounded-xl border border-border bg-surface-2 p-5">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Quick sales</h2>
				<div class="flex items-center gap-2">
					<label for="shift-picker" class="text-xs text-ink-muted">Shift</label>
					<select
						id="shift-picker"
						value={data.viewedShiftId ?? ''}
						onchange={(e) => viewShift(e.currentTarget.value)}
						class="rounded-md border border-input bg-transparent px-2 py-1 text-xs text-ink"
					>
						{#each data.shifts as s (s.id)}
							<option value={s.id}>{shiftLabel(s)}{s.id === data.openShiftId ? ' · open' : ''}</option>
						{/each}
					</select>
				</div>
			</div>

			{#if !data.hasOpenShift}
				<p class="mb-3 text-xs text-ink-muted">
					The dining drawer is closed right now — this is read-only history. Open a shift on
					<a href={shiftsHref} class="underline">Drawer</a> to take new cash sales.
				</p>
			{:else if data.viewedShiftId !== data.openShiftId}
				<p class="mb-3 text-xs text-ink-muted">Viewing a past shift — new sales still post to the currently open one.</p>
			{/if}

			{#if data.recentSales.length === 0}
				<p class="text-sm text-ink-muted">No quick sales on this shift.</p>
			{/if}
			<div class="divide-y divide-border">
				{#each data.recentSales as s (s.id)}
					<div class="flex items-center justify-between py-2 text-sm">
						<div class="min-w-0">
							<span class="text-ink">{s.items.map((i) => `${i.quantity}x ${i.description}`).join(', ')}</span>
							<span class="ml-2 text-xs text-ink-muted">{s.method.replace(/_/g, ' ')}</span>
						</div>
						<div class="flex items-center gap-3">
							<span class="font-medium text-ink">{peso(s.totalCentavos)}</span>
							<a
								href="/{page.params.hotel}/print/sale-receipt/{s.id}"
								target="_blank"
								rel="noopener"
								class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
							>
								Print
							</a>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
