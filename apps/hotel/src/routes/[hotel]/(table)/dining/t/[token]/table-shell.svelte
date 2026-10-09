<script lang="ts">
	import { browser } from '$app/environment';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import { setTableCart } from '$lib/dining-cart.svelte';
	import { inProgressLabel, liveCount } from '$lib/dining-qr-ui';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	// One cart for the whole visit, kept while the guest moves between the menu and My orders.
	const cart = setTableCart(page.params.token ?? '');
	if (browser) cart.load();
	$effect(() => cart.save());

	// Links are built from where we are now, so they work on a hotel's own domain as well as under /{slug}.
	const onOrders = $derived(/\/orders\/?$/.test(page.url.pathname));
	const menuHref = $derived(page.url.pathname.replace(/\/orders\/?$/, '').replace(/\/$/, ''));
	const ordersHref = $derived(`${menuHref}/orders`);

	const live = $derived(liveCount(data.orders));
	const logoUrl = $derived(page.data.branding?.logoUrl ?? null);

	// One quiet poll while anything is on its way (or the bill is open), so the badge and My orders stay current.
	$effect(() => {
		if (live === 0 && !data.checkOpen) return;
		const t = setInterval(() => {
			if (!document.hidden) invalidate('app:dining-qr');
		}, 10_000);
		return () => clearInterval(t);
	});
</script>

<div class="tq-shell">
	<header class="tq-bar">
		<div class="tq-bar-inner">
			<div class="tq-brand">
				{#if logoUrl}<img class="tq-logo" src={logoUrl} alt="" />{/if}
				<div class="tq-brand-text">
					<span class="tq-brand-name">{page.data.hotel?.name}</span>
					<span class="tq-table-pill">Table {data.table.name}{data.table.areaName ? ` · ${data.table.areaName}` : ''}</span>
				</div>
			</div>
			{#if onOrders}
				<a href={menuHref} class="tq-nav-btn"><ArrowLeftIcon class="size-4" aria-hidden="true" /> Menu</a>
			{:else}
				<a href={ordersHref} class="tq-nav-btn" aria-label={live > 0 ? `My orders, ${inProgressLabel(live)}` : 'My orders'}>
					<ReceiptTextIcon class="size-4" aria-hidden="true" />
					My orders
					{#if live > 0}<span class="tq-badge" aria-hidden="true">{live}</span>{/if}
				</a>
			{/if}
		</div>
	</header>

	{@render children()}
</div>
