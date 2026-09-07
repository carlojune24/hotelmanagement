<script lang="ts">
	import './woven-ledger.css';
	import { page } from '$app/state';
	import { setContext } from 'svelte';
	import { CartStore } from '$lib/cart.svelte';
	import FloatingInvoice from '$lib/components/storefront/floating-invoice.svelte';
	import BookingSummarySidebar from '$lib/components/storefront/booking-summary-sidebar.svelte';
	import { DEFAULT_DISPLAY_FONT, DISPLAY_FONTS } from '$lib/branding';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const cart = new CartStore(data.hotel.slug);
	setContext('cart', cart);

	/** The 5 real wizard steps. The room detail page (`rooms/[roomTypeId]`) is deliberately
	    NOT one of these — like the bare homepage, it runs its own Persuade-mode chrome (see
	    Acacia's own room-detail screenshots: no step tracker, its own right-column content is
	    Amenities, not a booking summary), reached either before or outside the wizard proper. */
	const STEP_ROUTES = [
		{ id: '/[hotel]/book/dates', label: 'Dates' },
		{ id: '/[hotel]/book/rooms', label: 'Select Rooms & Rates' },
		{ id: '/[hotel]/book/details', label: 'Guest Information' },
		{ id: '/[hotel]/book/review/[orderId]', label: 'Review & Payment' },
		{ id: '/[hotel]/book/confirmation/[orderId]', label: 'Confirmation' }
	];
	const currentStepIndex = $derived(STEP_ROUTES.findIndex((s) => s.id === page.route.id));
	/** The bare search page (and the room detail page) are Persuade mode, own nav/hero/chrome —
	    the task-flow chrome (compact header, horizontal step tracker) only shows once a guest
	    has entered the booking wizard proper, starting at the Dates step. */
	const showStepChrome = $derived(currentStepIndex >= 0);
	/** Booking Summary sidebar: Rooms & Rates and Guest Info only — the cart (and so the
	    sidebar's job) is done once `createOrder` succeeds and clears it; Review already has
	    its own authoritative, DB-backed itemized bill, and Confirmation shows the ticket. */
	const showSidebar = $derived(showStepChrome && currentStepIndex >= 1 && currentStepIndex <= 2);

	const fontDisplayFamily = $derived(
		DISPLAY_FONTS[data.branding.fontDisplay ?? DEFAULT_DISPLAY_FONT].family
	);
	const rootStyle = $derived(
		`--hotel-accent: ${data.theme.accent}; ` +
			`--hotel-accent-light: ${data.theme.accentLight}; ` +
			`--hotel-accent-deep: ${data.theme.accentDeep}; ` +
			`--hotel-woven-pattern: url("${data.theme.patternUri}"); ` +
			`--ledger-paper: ${data.theme.paper}; ` +
			`--ledger-paper-2: ${data.theme.paperDeep}; ` +
			`--ledger-page-bg: var(--ledger-paper); ` +
			`--ledger-font-display: ${fontDisplayFamily};`
	);
</script>

<svelte:head>
	<title>{data.hotel.name} — Book your stay</title>
</svelte:head>

<div class="woven-ledger" style={rootStyle}>
	{#if showStepChrome}
		<!-- Compact header: shown on every wizard step below the lg breakpoint, the only step
		     indicator there. -->
		<header class="ledger-hairline lg:hidden">
			<div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
				<a href="/{data.hotel.slug}/book" class="flex items-center gap-2.5">
					{#if data.branding.logoUrl}
						<img src={data.branding.logoUrl} alt="" class="h-8 w-auto object-contain" />
					{/if}
					<span class="ledger-display text-lg">{data.hotel.name}</span>
				</a>
				<div class="ledger-step">
					STEP {currentStepIndex + 1} OF {STEP_ROUTES.length} — {STEP_ROUTES[
						currentStepIndex
					]!.label.toUpperCase()}
				</div>
			</div>
		</header>

		<!-- Horizontal step tracker, desktop only (DESIGN.md Layout) — replaces the earlier
		     vertical left-rail; same active/done semantics and tokens, new geometry. -->
		<nav class="ledger-hairline hidden lg:block">
			<ol class="ledger-stepper-horizontal mx-auto max-w-5xl px-6 py-5">
				{#each STEP_ROUTES as step, i (step.id)}
					<li
						class="ledger-stepper-node {i === currentStepIndex ? 'is-active' : ''} {i <
						currentStepIndex
							? 'is-done'
							: ''}"
					>
						<span class="ledger-stepper-node-circle ledger-data"
							>{(i + 1).toString().padStart(2, '0')}</span
						>
						<span class="ledger-stepper-node-label">{step.label}</span>
					</li>
				{/each}
			</ol>
		</nav>

		<div
			class="mx-auto max-w-5xl px-4 py-8 sm:px-6 {showSidebar
				? 'lg:grid lg:grid-cols-[1fr_320px] lg:items-start lg:gap-8'
				: ''}"
		>
			<div class="min-w-0">
				{@render children()}
			</div>
			{#if showSidebar}
				<div class="mt-8 lg:sticky lg:top-8 lg:mt-0">
					<BookingSummarySidebar {cart} hotelSlug={data.hotel.slug} />
				</div>
			{/if}
		</div>
	{:else}
		{@render children()}
	{/if}
	<FloatingInvoice {cart} hotelSlug={data.hotel.slug} visible={!showStepChrome} />
</div>
