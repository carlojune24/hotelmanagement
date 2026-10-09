<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';
	import OrderCard from '$lib/components/table-order/order-card.svelte';
	import { billTotal, peso, summaryLine } from '$lib/dining-qr-ui';
	import { statusTone } from '$lib/dining-qr-ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const hotel = $derived(page.data.hotel!);
	const menuHref = $derived(page.url.pathname.replace(/\/orders\/?$/, '').replace(/\/$/, ''));
	const sent = $derived(page.url.searchParams.get('sent'));

	// Newest first: what the guest just did is at the top.
	const orders = $derived([...data.orders].reverse());
	const summary = $derived(summaryLine(data.orders));
	// The summary pill wears the colour of what is happening now: ready beats preparing beats sent.
	const headline = $derived(
		data.orders.some((o) => o.status === 'ready')
			? 'ready'
			: data.orders.some((o) => o.status === 'preparing')
				? 'preparing'
				: data.orders.some((o) => statusTone(o.status) === 'sent')
					? 'sent'
					: 'served'
	);
	const bill = $derived(billTotal(data.orders));
	const stamp = (iso: string) => new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: hotel.timezone }).format(new Date(iso));
</script>

<svelte:head>
	<title>My orders · Table {data.table.name} — {hotel.name}</title>
</svelte:head>

<main class="tq-main tq-narrow">
	<div class="tq-page-head">
		<h1 class="ledger-display tq-title">My orders</h1>
		<!-- Spoken when it changes, so a guest using a screen reader hears "Your food is on its way". -->
		<p class="tq-live-pill tone-{headline}" aria-live="polite" class:sr-only={!summary}>{summary}</p>
	</div>

	{#if sent}
		<p class="tq-note" role="status">
			<CircleCheckIcon class="size-4 shrink-0" aria-hidden="true" />
			<span>Order <span class="ledger-data">{sent}</span> is placed. The restaurant will confirm it in a moment.</span>
		</p>
	{/if}
	{#if form?.ok}<p class="tq-note" role="status"><CircleCheckIcon class="size-4 shrink-0" aria-hidden="true" /><span>{form.ok}</span></p>{/if}
	{#if form?.error}<p role="alert" class="tq-note is-bad">{form.error}</p>{/if}

	{#if orders.length === 0}
		<div class="tq-blank">
			<span class="tq-blank-icon"><UtensilsIcon class="size-7" aria-hidden="true" /></span>
			<p class="tq-blank-title">Nothing ordered yet</p>
			<p class="tq-blank-body">Dishes you order will show up here, so you can see where each one is.</p>
			<a href={menuHref} class="ledger-btn-primary tq-btn tq-btn-lg">Browse the menu</a>
		</div>
	{:else}
		<ul class="tq-orders" aria-label="Orders at this table">
			{#each orders as o (o.code)}
				<OrderCard order={o} time={stamp(o.createdAt)} />
			{/each}
		</ul>

		{#if data.checkOpen}
			<section class="tq-bill" aria-label="Your bill">
				<p class="tq-total">
					<span>Your bill so far <span class="tq-total-note">VAT included</span></span>
					<span class="tq-total-amount">{peso(bill)}</span>
				</p>
				{#if data.billRequested}
					<p class="tq-note"><CircleCheckIcon class="size-4 shrink-0" aria-hidden="true" /><span>Your waiter knows you would like the bill and is on the way.</span></p>
				{:else}
					<form
						method="POST"
						action="?/bill"
						use:enhance={() => async ({ update }) => {
							await update({ reset: false });
							await invalidate('app:dining-qr');
						}}
					>
						<button type="submit" class="ledger-btn-primary tq-btn tq-btn-lg tq-btn-block">Ask for the bill</button>
					</form>
					<p class="tq-fine">You pay at the cash desk. A waiter will bring the bill.</p>
				{/if}
			</section>
		{/if}

		<a href={menuHref} class="tq-btn tq-btn-outline tq-btn-lg tq-btn-block tq-more">Order more</a>
	{/if}
</main>
