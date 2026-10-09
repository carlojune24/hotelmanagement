<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance, applyAction, deserialize } from '$app/forms';
	import { goto, invalidate, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChefHatIcon from '@lucide/svelte/icons/chef-hat';
	import NewOrderSheet from './new-order-sheet.svelte';
	import PayDialog from './pay-dialog.svelte';
	import OrderDetailSheet from './order-detail-sheet.svelte';
	import SummaryTiles from './summary-tiles.svelte';
	import ReadyCard from './ready-card.svelte';
	import QueueCard from './queue-card.svelte';
	import ServedList from './served-list.svelte';
	import ThreadSheet from './thread-sheet.svelte';
	import RefundDialog from './refund-dialog.svelte';
	import SettleDialog from '../floor/settle-dialog.svelte';
	import QrCodeIcon from '@lucide/svelte/icons/qr-code';
	import ArmchairIcon from '@lucide/svelte/icons/armchair';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { CHECK_STAGE_LABEL } from '$lib/dining-checks';
	import { formatWait } from '$lib/dining-orders';
	import { boardGroups, boardSummary } from '$lib/orders-board';
	import { batchPrintHref } from '$lib/print-batch';
	import SearchIcon from '@lucide/svelte/icons/search';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import XIcon from '@lucide/svelte/icons/x';
	import BanknoteArrowUpIcon from '@lucide/svelte/icons/banknote-arrow-up';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Order = PageData['orders'][number];
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const slug = $derived(page.params.hotel!);
	const base = $derived(`/${slug}/management/dining`);

	// Ticks every 30 s (see the polling effect below) so waits stay current between refreshes.
	let nowMs = $state(Date.now());

	// The board: search and "to pay" narrow the sections; the tiles always show the whole board.
	let query = $state('');
	let unpaidOnly = $state(false);
	const groups = $derived(boardGroups(data.orders, nowMs, { query, unpaidOnly }));
	const summary = $derived(boardSummary(data.orders, nowMs));
	const filtering = $derived(query.trim() !== '' || unpaidOnly);
	const shownCount = $derived(groups.ready.length + groups.preparing.length + groups.fresh.length + groups.served.length);
	// Table-QR orders a waiter has to accept before the kitchen sees them.
	const awaitingQr = $derived(data.orders.filter((o) => o.status === 'pending_acceptance'));
	const waitedMin = (o: Order) => Math.max(0, Math.floor((nowMs - new Date(o.createdAt).getTime()) / 60_000));

	function jumpTo(section: 'ready' | 'preparing' | 'new') {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		document.getElementById(`orders-${section}`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
	}

	let detailOpen = $state(false);
	let detailOrderId = $state<string | null>(null);
	const detailOrder = $derived(data.orders.find((o) => o.id === detailOrderId) ?? null);
	function openDetails(o: Order) {
		detailOrderId = o.id;
		detailOpen = true;
	}
	let servingId = $state<string | null>(null);

	// ---- the board stays current by polling (no push) ---------------------------------
	$effect(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 30_000);
		const refresh = setInterval(() => {
			if (!document.hidden) invalidate('app:dining-orders');
		}, 20_000);
		return () => {
			clearInterval(clock);
			clearInterval(refresh);
		};
	});

	// ---- venue filter -----------------------------------------------------------------
	const filterLabel = $derived(data.venues.find((v) => v.id === data.venueId)?.title ?? 'All venues');
	function setVenue(v: string) {
		goto(v === 'all' ? '?' : `?venue=${v}`, { keepFocus: true, noScroll: true });
	}

	// ---- actions ----------------------------------------------------------------------
	// The only step taken here: serving an order the kitchen has marked ready.
	async function advance(order: Order, to: string) {
		if (servingId) return;
		servingId = order.id;
		try {
			const body = new FormData();
			body.set('orderId', order.id);
			body.set('to', to);
			const res = await fetch('?/advance', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
			const result = deserialize(await res.text());
			await applyAction(result);
			if (result.type === 'success') await invalidateAll();
		} finally {
			servingId = null;
		}
	}

	let newOpen = $state(false);
	// "New order" on a Floor table lands here with ?newOrder=1&table=…: open the sheet on that table, then tidy the URL.
	let newTable = $state<string | null>(null);
	let handledDeepLink = false;
	$effect(() => {
		if (handledDeepLink || page.url.searchParams.get('newOrder') !== '1') return;
		handledDeepLink = true;
		newTable = page.url.searchParams.get('table');
		newOpen = true;
		untrack(() => goto(page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true }));
	});
	let payOpen = $state(false);
	let payOrderId = $state<string | null>(null);
	let pendingPayId = $state<string | null>(null);
	const payOrder = $derived(data.orders.find((o) => o.id === payOrderId) ?? null);

	function openPay(order: Order) {
		payOrderId = order.id;
		payOpen = true;
	}
	function placed(o: { id: string; code: string }, payNow: boolean) {
		if (payNow) pendingPayId = o.id;
	}
	// "Place & pay": open the payment dialog as soon as the new order is on the board.
	$effect(() => {
		if (!pendingPayId) return;
		const o = data.orders.find((x) => x.id === pendingPayId);
		if (o) {
			pendingPayId = null;
			openPay(o);
		}
	});

	let threadOpen = $state(false);
	let threadOrderId = $state<string | null>(null);
	const threadOrder = $derived(data.orders.find((o) => o.id === threadOrderId) ?? null);
	let respondFor = $state<Order | null>(null);
	let refundOpen = $state(false);
	let refundOrderId = $state<string | null>(null);
	const refundOrder = $derived([...data.refundDue, ...data.orders].find((o) => o.id === refundOrderId) ?? null);
	const refundOwed = (o: { totalCentavos: number; refundedCentavos: number }) => Math.max(0, o.totalCentavos - o.refundedCentavos);

	let undoRoomFor = $state<Order | null>(null);
	let cancelFor = $state<Order | null>(null);
	let declineFor = $state<Order | null>(null);
	let settleOpen = $state(false);
	let settleFor = $state<(typeof data.openChecks)[number] | null>(null);
	let voidFor = $state<Order | null>(null);
	let invoiceFor = $state<Order | null>(null);

	async function issueReceipt(order: Order) {
		const body = new FormData();
		body.set('orderId', order.id);
		body.set('type', 'official_receipt');
		const res = await fetch('?/issueDocument', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		await applyAction(result);
		if (result.type === 'success') await invalidateAll();
	}

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok && !form.placed) toast.success(form.ok);
		if (form?.ok) {
			cancelFor = null;
			declineFor = null;
			voidFor = null;
			respondFor = null;
			refundOpen = false;
			undoRoomFor = null;
		}
		const issued = form?.issued as { id: string; type: string; formattedNo: string } | undefined;
		if (issued) {
			invoiceFor = null;
			toast.success(`${issued.type === 'invoice' ? 'Invoice' : 'Official receipt'} ${issued.formattedNo} issued.`, {
				action: { label: 'Print', onClick: () => window.open(batchPrintHref(slug, [issued.id], { auto: true }), '_blank') }
			});
		}
	});
</script>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
		<p class="mr-auto text-sm text-ink-muted" aria-live="polite">
			<span class="text-base font-semibold text-ink">
				{data.orders.length === 0 ? 'No open orders' : `${data.orders.length} on the board`}{summary.unpaid > 0 ? ` · ${summary.unpaid} to pay` : ''}
			</span>
			<span class="ml-2 text-xs">Updates every 20 seconds</span>
			{#if data.awaitingPayment > 0}
				<span class="ml-2 text-xs" title="Online orders the guest has not paid for yet. They reach the kitchen once payment is confirmed.">
					· {data.awaitingPayment} awaiting online payment
				</span>
			{/if}
		</p>
		<div class="flex w-full flex-wrap items-center gap-2 sm:w-auto">
			<div class="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
				<SearchIcon class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
				<Input type="search" bind:value={query} placeholder="Search table, order ID or dish" aria-label="Search orders" class="h-10 pl-9" />
			</div>
			{#if data.venues.length > 1}
				<Select.Root type="single" value={data.venueId ?? 'all'} onValueChange={setVenue}>
					<Select.Trigger class="h-10 w-44" aria-label="Venue">{filterLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value="all" label="All venues" />
						{#each data.venues as v (v.id)}<Select.Item value={v.id} label={v.title} />{/each}
					</Select.Content>
				</Select.Root>
			{/if}
			{#if data.canWrite}
				<Button class="h-10" onclick={() => (newOpen = true)} disabled={Object.keys(data.menus).length === 0}>
					<PlusIcon class="size-4" /> New order
				</Button>
			{/if}
		</div>
	</div>

	{#if awaitingQr.length > 0}
		<section class="mb-5 rounded-xl border-2 border-brand/60 bg-brand/5" aria-label="Table orders waiting for you">
			<h2 class="flex items-center gap-2 border-b border-brand/30 px-4 py-2.5 text-sm font-semibold text-ink">
				<QrCodeIcon class="size-4 text-brand" aria-hidden="true" />
				Table orders waiting for you <span class="font-normal tabular-nums text-ink-muted">· {awaitingQr.length}</span>
			</h2>
			<ul class="divide-y divide-brand/20">
				{#each awaitingQr as o (o.id)}
					<li class="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
						<div class="min-w-0 flex-1">
							<p class="flex flex-wrap items-baseline gap-x-2 text-sm">
								<span class="font-semibold text-ink">Table {o.tableLabel ?? '?'}</span>
								<span class="font-mono text-xs text-ink-muted">{o.code}</span>
								<span class="text-xs tabular-nums text-ink-muted">{formatWait(waitedMin(o))} ago</span>
							</p>
							<ul class="mt-1 text-sm text-ink">
								{#each o.items as i (i.id)}
									<li>
										<span class="tabular-nums text-ink-muted">{i.quantity}×</span> {i.name}{#if i.addons.length > 0}<span class="text-ink-muted"> ({i.addons.join(', ')})</span>{/if}{#if i.remarks}<span class="italic"> “{i.remarks}”</span>{/if}
									</li>
								{/each}
							</ul>
							{#if o.remarks}<p class="mt-1 text-xs italic text-ink">Note: {o.remarks}</p>{/if}
						</div>
						<span class="font-medium tabular-nums text-ink">{peso(o.totalCentavos)}</span>
						{#if data.canWrite}
							<div class="flex items-center gap-2">
								<form method="POST" action="?/accept" use:enhance={() => async ({ update }) => { await update({ reset: false }); await invalidateAll(); }}>
									<input type="hidden" name="orderId" value={o.id} />
									<Button type="submit" size="sm">Accept</Button>
								</form>
								<Button size="sm" variant="outline" onclick={() => (declineFor = o)}>Decline</Button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if data.venues.length === 0 || Object.keys(data.menus).length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<ChefHatIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">Add dishes to a venue's menu, then take orders here.</p>
			<Button href="{base}/menu" variant="outline">Go to the menu</Button>
		</div>
	{:else}
		<SummaryTiles {summary} bind:unpaidOnly onjump={jumpTo} />

		{#if filtering}
			<p class="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted" role="status">
				{shownCount === 0 ? 'No orders match.' : `Showing ${shownCount} ${shownCount === 1 ? 'order' : 'orders'}`}
				{#if unpaidOnly}<span class="rounded-md bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">Unpaid only</span>{/if}
				{#if query.trim()}<span class="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink">“{query.trim()}”</span>{/if}
				<Button variant="ghost" size="sm" class="h-8 gap-1" onclick={() => { query = ''; unpaidOnly = false; }}>
					<XIcon class="size-3.5" aria-hidden="true" /> Clear
				</Button>
			</p>
		{/if}

		<div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<div class="min-w-0 space-y-8">
				<section id="orders-ready" class="scroll-mt-4" aria-labelledby="ready-heading">
					<h2 id="ready-heading" class="mb-3 flex items-center gap-2">
						<span class="size-2.5 rounded-full bg-ok" aria-hidden="true"></span>
						<span class="text-lg font-semibold text-ink">Ready to serve</span>
						<span class="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink">{groups.ready.length}</span>
						<span class="ml-auto text-xs text-ink-muted">Longest waiting first</span>
					</h2>
					{#if groups.ready.length > 0}
						<div class="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">
							{#each groups.ready as order (order.id)}
								<ReadyCard
									{order}
									{nowMs}
									canWrite={data.canWrite}
									busy={servingId === order.id}
									onserve={(o) => advance(o, 'served')}
									onpay={openPay}
									ondetails={openDetails}
								/>
							{/each}
						</div>
					{:else}
						<p class="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
							{filtering ? 'No ready orders match.' : 'Nothing waiting at the pass. The kitchen will tell you when a dish is ready.'}
						</p>
					{/if}
				</section>

				<section id="orders-preparing" class="scroll-mt-4" aria-labelledby="preparing-heading">
					<h2 id="preparing-heading" class="mb-3 flex items-center gap-2">
						<span class="size-2.5 rounded-full bg-warning" aria-hidden="true"></span>
						<span class="text-lg font-semibold text-ink">Preparing</span>
						<span class="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink">{groups.preparing.length}</span>
						<span class="ml-auto text-xs text-ink-muted">Late orders first</span>
					</h2>
					{#if groups.preparing.length > 0}
						<div class="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-3">
							{#each groups.preparing as order (order.id)}
								<QueueCard {order} {nowMs} ondetails={openDetails} />
							{/each}
						</div>
					{:else}
						<p class="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-ink-muted">
							{filtering ? 'No preparing orders match.' : 'Nothing cooking right now.'}
						</p>
					{/if}
				</section>

				<section id="orders-new" class="scroll-mt-4" aria-labelledby="new-heading">
					<h2 id="new-heading" class="mb-3 flex items-center gap-2">
						<span class="size-2.5 rounded-full bg-brand" aria-hidden="true"></span>
						<span class="text-lg font-semibold text-ink">New</span>
						<span class="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink">{groups.fresh.length}</span>
						<span class="ml-auto text-xs text-ink-muted">Waiting for the kitchen to start</span>
					</h2>
					{#if groups.fresh.length > 0}
						<div class="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-3">
							{#each groups.fresh as order (order.id)}
								<QueueCard {order} {nowMs} ondetails={openDetails} />
							{/each}
						</div>
					{:else}
						<p class="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-ink-muted">
							{filtering ? 'No new orders match.' : 'No new orders.'}
						</p>
					{/if}
				</section>

				{#if data.openChecks.length > 0}
					<section aria-label="Tables with open checks">
						<h2 class="mb-3 flex items-center gap-2 text-lg font-semibold text-ink">
							<ArmchairIcon class="size-4 text-ink-muted" aria-hidden="true" />
							Tables <span class="text-sm font-normal tabular-nums text-ink-muted">· {data.openChecks.length} open</span>
						</h2>
						<div class="flex gap-3 overflow-x-auto pb-1">
							{#each data.openChecks as c (c.id)}
								<div class="w-64 shrink-0 rounded-xl border-2 bg-surface p-3 {c.stage === 'needs_payment' ? 'border-warning/70' : c.stage === 'ready_to_clear' ? 'border-brand/60' : 'border-border'}">
									<div class="flex items-center justify-between gap-2">
										<p class="font-semibold text-ink">Table {c.tableName}</p>
										<Badge variant={c.stage === 'needs_payment' ? 'destructive' : c.stage === 'ready_to_clear' ? 'default' : 'outline'}>{CHECK_STAGE_LABEL[c.stage]}</Badge>
									</div>
									<p class="mt-1 text-xs text-ink-muted">
										{c.liveCount} {c.liveCount === 1 ? 'order' : 'orders'} · {peso(c.totalCentavos)}{c.unpaidCentavos > 0 ? ` · ${peso(c.unpaidCentavos)} to pay` : ''}
									</p>
									{#if c.billRequestedAt}<p class="mt-1 text-xs font-medium text-warning">Asked for the bill</p>{/if}
									{#if c.liveCount > 0}
										<a class="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand underline-offset-2 hover:underline" href="/{slug}/print/bill/check/{c.id}?auto=1" target="_blank" rel="noopener">
											<PrinterIcon class="size-3" aria-hidden="true" /> Print bill
										</a>
									{/if}
									{#if data.canWrite}
										<div class="mt-2 flex gap-2">
											{#if c.unpaidCount > 0 && c.awaitingAcceptance === 0}
												<Button size="sm" onclick={() => { settleFor = c; settleOpen = true; }}>Settle &amp; close</Button>
											{:else if c.stage === 'ready_to_clear'}
												<form method="POST" action="?/closeTable" use:enhance={() => async ({ update }) => { await update({ reset: false }); await invalidateAll(); }}>
													<input type="hidden" name="checkId" value={c.id} />
													<Button type="submit" size="sm">Close table</Button>
												</form>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</section>
				{/if}

				{#if data.refundDue.length > 0}
					<section class="rounded-xl border border-border bg-surface" aria-label="Refunds due">
						<h2 class="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm font-semibold text-ink">
							<BanknoteArrowUpIcon class="size-4 text-brand" aria-hidden="true" />
							Refunds due <span class="font-normal tabular-nums text-ink-muted">· {data.refundDue.length}</span>
						</h2>
						<ul class="divide-y divide-border">
							{#each data.refundDue as o (o.id)}
								<li class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
									<span class="font-mono font-semibold text-ink">{o.code}</span>
									<span class="min-w-0 flex-1 truncate text-ink-muted">
										{o.guestName ?? 'Guest'}{o.guestPhone ? ` · ${o.guestPhone}` : ''} · cancelled{o.refundedCentavos > 0 ? ' · part refunded' : ''}
									</span>
									<span class="font-medium tabular-nums text-ink">{peso(refundOwed(o))}</span>
									{#if o.unreadMessages > 0 || o.source === 'online'}
										<Button variant="ghost" size="sm" onclick={() => { threadOrderId = o.id; threadOpen = true; }}>Messages{o.unreadMessages > 0 ? ` (${o.unreadMessages})` : ''}</Button>
									{/if}
									{#if data.canVoid}
										<Button size="sm" onclick={() => { refundOrderId = o.id; refundOpen = true; }}>Record refund</Button>
									{:else}
										<span class="text-xs text-ink-muted">A manager records the refund</span>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</div>

			<aside class="min-w-0 lg:sticky lg:top-4 lg:self-start" aria-label="Served orders">
				<ServedList orders={groups.served} {nowMs} ondetails={openDetails} />
			</aside>
		</div>
	{/if}
</div>

<OrderDetailSheet
	bind:open={detailOpen}
	order={detailOrder}
	{nowMs}
	{slug}
	timezone={data.timezone}
	canWrite={data.canWrite}
	canVoid={data.canVoid}
	onadvance={advance}
	onpay={openPay}
	oncancel={(o) => (cancelFor = o)}
	onvoid={(o) => (voidFor = o)}
	oninvoice={(o) => (invoiceFor = o)}
	onissuereceipt={issueReceipt}
	ontalk={(o) => { threadOrderId = o.id; threadOpen = true; }}
	onrespond={(o) => (respondFor = o)}
	onundoroom={(o) => (undoRoomFor = o)}
/>

<NewOrderSheet bind:open={newOpen} {data} defaultVenueId={data.venueId} defaultTableId={newTable} onplaced={placed} />
<PayDialog bind:open={payOpen} order={payOrder} shiftOpen={data.shiftOpen} {slug} inHouse={data.inHouse} />
<ThreadSheet bind:open={threadOpen} order={threadOrder ?? data.refundDue.find((o) => o.id === threadOrderId) ?? null} canWrite={data.canWrite} timezone={data.timezone} />
<RefundDialog bind:open={refundOpen} order={refundOrder} />
<SettleDialog bind:open={settleOpen} check={settleFor} shiftOpen={data.shiftOpen} {slug} inHouse={data.inHouse} />

<!-- Decline a table-QR order -->
<Dialog.Root open={declineFor !== null} onOpenChange={(o) => { if (!o) declineFor = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		{#if declineFor}
			<Dialog.Header>
				<Dialog.Title>Decline {declineFor.code}?</Dialog.Title>
				<Dialog.Description>The guest at table {declineFor.tableLabel ?? '?'} sees your reason on their phone.</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/cancel" use:enhance class="space-y-3">
				<input type="hidden" name="orderId" value={declineFor.id} />
				<div>
					<Label for="declineReason">Reason</Label>
					<Input id="declineReason" name="reason" required maxlength={300} placeholder="Sold out, kitchen closed…" class="mt-1" />
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (declineFor = null)}>Keep waiting</Button>
					<Button type="submit" variant="destructive">Decline order</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Answer a guest's request to cancel a paid order -->
<Dialog.Root open={respondFor !== null} onOpenChange={(o) => { if (!o) respondFor = null; }}>
	<Dialog.Content class="sm:max-w-md">
		{#if respondFor}
			<Dialog.Header>
				<Dialog.Title>{respondFor.code}: cancellation request</Dialog.Title>
				<Dialog.Description>
					{respondFor.guestName ?? 'The guest'} paid {peso(respondFor.totalCentavos)} and asked to cancel{respondFor.cancelRequestNote ? `: “${respondFor.cancelRequestNote}”` : '.'}
					If you approve, the order is cancelled and the amount appears under Refunds due.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/respondCancel" use:enhance class="space-y-3">
				<input type="hidden" name="orderId" value={respondFor.id} />
				<div>
					<Label for="respMsg">Message to the guest (optional)</Label>
					<Textarea id="respMsg" name="message" rows={2} maxlength={500} placeholder="A short note they will see on their order page" class="mt-1 min-h-0" />
				</div>
				<Dialog.Footer class="gap-2">
					<Button type="button" variant="ghost" onclick={() => (respondFor = null)}>Not now</Button>
					<Button type="submit" name="approve" value="false" variant="outline">Decline</Button>
					<Button type="submit" name="approve" value="true">Approve and cancel</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Cancel an unpaid order -->
<Dialog.Root open={cancelFor !== null} onOpenChange={(o) => { if (!o) cancelFor = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		{#if cancelFor}
			<Dialog.Header>
				<Dialog.Title>Cancel {cancelFor.code}?</Dialog.Title>
				<Dialog.Description>The kitchen will stop preparing it. A reason is kept in the audit log.</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/cancel" use:enhance class="space-y-3">
				<input type="hidden" name="orderId" value={cancelFor.id} />
				<div>
					<Label for="cancelReason">Reason</Label>
					<Input id="cancelReason" name="reason" required maxlength={300} placeholder="Guest left, wrong table…" class="mt-1" />
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (cancelFor = null)}>Keep order</Button>
					<Button type="submit" variant="destructive">Cancel order</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Take an order off a guest's room bill (managers) -->
<Dialog.Root open={undoRoomFor !== null} onOpenChange={(o) => { if (!o) undoRoomFor = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		{#if undoRoomFor}
			<Dialog.Header>
				<Dialog.Title>Take {undoRoomFor.code} off room {undoRoomFor.roomLabel}'s bill?</Dialog.Title>
				<Dialog.Description>
					The charge is removed from {undoRoomFor.guestName ?? "the guest"}'s room bill and the order goes back to unpaid, so you can charge it to another room or take payment now.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/undoRoomCharge" use:enhance class="space-y-3">
				<input type="hidden" name="orderId" value={undoRoomFor.id} />
				<div>
					<Label for="undoReason">Reason</Label>
					<Input id="undoReason" name="reason" required maxlength={300} placeholder="Wrong room, guest will pay now…" class="mt-1" />
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (undoRoomFor = null)}>Keep on the bill</Button>
					<Button type="submit" variant="destructive">Take off the bill</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Void a payment (managers) -->
<Dialog.Root open={voidFor !== null} onOpenChange={(o) => { if (!o) voidFor = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		{#if voidFor}
			<Dialog.Header>
				<Dialog.Title>Void the payment for {voidFor.code}?</Dialog.Title>
				<Dialog.Description>
					The money is taken back out of the cash ledger and the official receipt is cancelled (its number is never reused). The order goes back to unpaid.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/voidPayment" use:enhance class="space-y-3">
				<input type="hidden" name="orderId" value={voidFor.id} />
				<div>
					<Label for="voidReason">Reason</Label>
					<Input id="voidReason" name="reason" required maxlength={300} placeholder="Charged twice, wrong amount…" class="mt-1" />
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (voidFor = null)}>Keep payment</Button>
					<Button type="submit" variant="destructive">Void payment</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Issue an invoice, with optional bill-to details -->
<Dialog.Root open={invoiceFor !== null} onOpenChange={(o) => { if (!o) invoiceFor = null; }}>
	<Dialog.Content class="sm:max-w-md">
		{#if invoiceFor}
			<Dialog.Header>
				<Dialog.Title>Issue an invoice for {invoiceFor.code}</Dialog.Title>
				<Dialog.Description>
					Uses the next number in your BIR invoice series. Fill in the billed party if the guest or a company needs their name or TIN on it.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/issueDocument" use:enhance class="space-y-3">
				<input type="hidden" name="orderId" value={invoiceFor.id} />
				<input type="hidden" name="type" value="invoice" />
				<div>
					<Label for="billName">Billed to (optional)</Label>
					<Input id="billName" name="billToName" maxlength={160} value={invoiceFor.guestName ?? ''} class="mt-1" />
				</div>
				<div>
					<Label for="billTin">TIN (optional)</Label>
					<Input id="billTin" name="billToTin" maxlength={40} class="mt-1" />
				</div>
				<div>
					<Label for="billAddr">Address (optional)</Label>
					<Textarea id="billAddr" name="billToAddress" rows={2} maxlength={300} class="mt-1" />
				</div>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (invoiceFor = null)}>Cancel</Button>
					<Button type="submit">Issue invoice</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
