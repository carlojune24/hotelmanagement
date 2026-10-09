<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import { batchPrintHref } from '$lib/print-batch';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ReceiptTextIcon from '@lucide/svelte/icons/receipt-text';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import BedDoubleIcon from '@lucide/svelte/icons/bed-double';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChefHatIcon from '@lucide/svelte/icons/chef-hat';
	import {
		ORDER_TYPE_LABEL,
		formatWait,
		groupByStation,
		waitLevel
	} from '$lib/dining-orders';
	import type { PageData } from './$types';

	type Order = PageData['orders'][number];

	let {
		order,
		nowMs,
		canWrite,
		canVoid,
		slug,
		timezone,
		onadvance,
		onpay,
		oncancel,
		onvoid,
		oninvoice,
		onissuereceipt,
		ontalk,
		onrespond,
		onundoroom
	}: {
		order: Order;
		nowMs: number;
		canWrite: boolean;
		canVoid: boolean;
		slug: string;
		timezone: string;
		onadvance: (order: Order, to: string) => void;
		onpay: (order: Order) => void;
		oncancel: (order: Order) => void;
		onvoid: (order: Order) => void;
		oninvoice: (order: Order) => void;
		onissuereceipt: (order: Order) => void;
		ontalk: (order: Order) => void;
		onrespond: (order: Order) => void;
		onundoroom: (order: Order) => void;
	} = $props();

	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const minutes = $derived(Math.max(0, Math.floor((nowMs - new Date(order.createdAt).getTime()) / 60_000)));
	const ageLabel = $derived(formatWait(minutes));
	const cooking = $derived(order.status === 'new' || order.status === 'accepted' || order.status === 'preparing');
	const level = $derived(cooking ? waitLevel(minutes) : 'ok');
	const late = $derived(level === 'late');
	// Where each station is, once an order is split across more than one.
	const stations = $derived(cooking ? groupByStation(order.items) : []);

	// Start and Ready belong to the Kitchen tab. The one step dining staff take here is serving a ready order.
	const next = $derived(order.status === 'ready' ? ('served' as const) : undefined);
	const NEXT_LABEL: Record<string, string> = { served: 'Mark served' };
	const receipt = $derived(order.documents.find((d) => d.type === 'official_receipt'));
	const invoice = $derived(order.documents.find((d) => d.type === 'invoice'));
	const unpaid = $derived(order.paymentStatus === 'unpaid');
	const roomCharged = $derived(order.paymentStatus === 'room_charged');
	const paid = $derived(order.paymentStatus === 'paid');
	const METHOD: Record<string, string> = { paymongo: 'Online', cash: 'Cash', card: 'Card', gcash: 'GCash', maya: 'Maya', room_charge: 'Room' };
	const pickup = $derived(
		order.pickupAt
			? new Intl.DateTimeFormat('en-PH', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(order.pickupAt))
			: null
	);
	const hasThread = $derived(order.source === 'online' || order.unreadMessages > 0);
</script>

<article class="rounded-xl border border-border bg-surface p-3.5" aria-label="Order {order.code}">
	<header class="flex items-start justify-between gap-2">
		<div class="min-w-0">
			<p class="flex items-center gap-1.5 font-mono text-sm font-semibold text-ink">
				{order.code}
				{#if order.source === 'online'}<span class="inline-flex items-center gap-0.5 font-sans text-[11px] font-medium text-ink-muted"><GlobeIcon class="size-3" aria-hidden="true" /> Online</span>{/if}
			</p>
			<p class="truncate text-xs text-ink-muted">
				{order.tableLabel ? `Table ${order.tableLabel}` : ORDER_TYPE_LABEL[order.orderType]}{order.tableLabel && order.orderType === 'takeaway' ? ' · Takeaway' : ''}{order.guestName ? ` · ${order.guestName}` : ''}
			</p>
		</div>
		<span
			class="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums {late ? 'font-semibold text-danger' : level === 'slow' ? 'font-semibold text-warning' : 'text-ink-muted'}"
			title="Time since the order was placed"
		>
			{#if level !== 'ok'}<ClockIcon class="size-3" aria-hidden="true" />{/if}
			{ageLabel}{late ? ' · late' : level === 'slow' ? ' · slow' : ''}
		</span>
	</header>

	{#if pickup}
		<p class="mt-1.5 text-xs text-ink">
			{order.orderType === 'pre_order' ? 'At the table' : 'Pickup'} <span class="font-medium tabular-nums">{pickup}</span>
		</p>
	{/if}

	{#if order.bookingCode}
		<p class="mt-1.5 flex items-center gap-1 text-xs text-ink-muted">
			<BedDoubleIcon class="size-3" aria-hidden="true" />
			{#if roomCharged}Charged to room {order.roomLabel}{:else}In-house{/if}, booking <span class="font-mono">{order.bookingCode}</span>
		</p>
	{/if}

	<ul class="mt-3 space-y-1.5 text-sm">
		{#each order.items as i (i.id)}
			<li>
				<p class="text-ink"><span class="tabular-nums text-ink-muted">{i.quantity}×</span> {i.name}</p>
				{#each i.addons as a (a)}<p class="pl-5 text-xs text-ink-muted">+ {a}</p>{/each}
				{#if i.remarks}<p class="pl-5 text-xs italic text-ink">“{i.remarks}”</p>{/if}
			</li>
		{/each}
	</ul>

	{#if cooking}
		<p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted" aria-label="Kitchen progress">
			<span class="inline-flex items-center gap-1 font-medium text-ink">
				<ChefHatIcon class="size-3.5" aria-hidden="true" />
				{order.status === 'preparing' ? 'With the kitchen' : 'Waiting for the kitchen to start'}
			</span>
			{#if stations.length > 1}
				{#each stations as g (g.key)}
					<span class="inline-flex items-center gap-1 {g.state === 'ready' ? 'text-ink' : ''}">
						{#if g.state === 'ready'}<CheckIcon class="size-3" aria-hidden="true" />{/if}
						{g.label} · {g.state === 'ready' ? 'ready' : g.state === 'cooking' ? 'cooking' : 'waiting'}
					</span>
				{/each}
			{/if}
		</p>
	{/if}

	{#if order.remarks}
		<p class="mt-2 rounded-md bg-surface-2 px-2 py-1.5 text-xs text-ink">{order.remarks}</p>
	{/if}

	{#if order.cancelRequestedAt}
		<div class="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-xs" role="alert">
			<p class="font-medium text-ink">The guest asked to cancel this paid order</p>
			{#if order.cancelRequestNote}<p class="mt-0.5 text-ink-muted">“{order.cancelRequestNote}”</p>{/if}
			{#if canWrite}<Button size="sm" variant="outline" class="mt-2" onclick={() => onrespond(order)}>Reply to request</Button>{/if}
		</div>
	{/if}

	<footer class="mt-3 space-y-4 border-t border-border pt-3">
		<div class="flex items-center justify-between gap-2">
			<span class="text-lg font-semibold tabular-nums text-ink">{peso(order.totalCentavos)}</span>
			{#if unpaid}
				<Badge variant="outline">Unpaid</Badge>
			{:else if roomCharged}
				<Badge variant="secondary">Room {order.roomLabel ?? ''}</Badge>
			{:else}
				<Badge variant="secondary">Paid · {METHOD[order.paymentMethod ?? ''] ?? order.paymentMethod ?? ''}</Badge>
			{/if}
		</div>

		<!-- What was printed or can be: every document is one button, no menu to open. -->
		<section aria-label="Documents">
			<h3 class="mb-1.5 text-xs font-medium text-ink-muted">Documents</h3>
			<div class="grid grid-cols-2 gap-2">
				<Button variant="outline" class="h-11 justify-start gap-2" onclick={() => window.open(`/${slug}/print/bill/order/${order.id}?auto=1`, '_blank')}>
					<PrinterIcon class="size-4 shrink-0" aria-hidden="true" /> Print bill
				</Button>
				{#if receipt}
					<Button href={batchPrintHref(slug, [receipt.id])} target="_blank" rel="noopener" variant="outline" class="h-11 justify-start gap-2">
						<ReceiptTextIcon class="size-4 shrink-0" aria-hidden="true" />
						<span class="min-w-0 truncate">Receipt <span class="font-mono text-xs">{receipt.formattedNo}</span></span>
					</Button>
				{:else if paid && canWrite}
					<Button variant="outline" class="h-11 justify-start gap-2 border-dashed" onclick={() => onissuereceipt(order)}>
						<PlusIcon class="size-4 shrink-0" aria-hidden="true" /> Issue receipt
					</Button>
				{/if}
				{#if invoice}
					<Button href={batchPrintHref(slug, [invoice.id])} target="_blank" rel="noopener" variant="outline" class="h-11 justify-start gap-2">
						<ReceiptTextIcon class="size-4 shrink-0" aria-hidden="true" />
						<span class="min-w-0 truncate">Invoice <span class="font-mono text-xs">{invoice.formattedNo}</span></span>
					</Button>
				{:else if !roomCharged && canWrite}
					<Button variant="outline" class="h-11 justify-start gap-2 border-dashed" onclick={() => oninvoice(order)}>
						<PlusIcon class="size-4 shrink-0" aria-hidden="true" /> Issue invoice…
					</Button>
				{/if}
			</div>
		</section>

		{#if canWrite && (next || unpaid || hasThread)}
			<section class="flex flex-wrap gap-2" aria-label="Order actions">
				{#if next}
					<Button class="h-11 flex-1" variant={unpaid && order.status === 'served' ? 'outline' : 'default'} onclick={() => onadvance(order, next)}>
						{NEXT_LABEL[next]}
					</Button>
				{/if}
				{#if unpaid}
					<Button class="h-11 flex-1" variant={next ? 'outline' : 'default'} onclick={() => onpay(order)}>Take payment</Button>
				{/if}
				{#if hasThread}
					<Button variant="outline" class="relative h-11 flex-1 gap-2" onclick={() => ontalk(order)}>
						<MessageSquareIcon class="size-4" aria-hidden="true" />
						Messages
						{#if order.unreadMessages > 0}
							<span class="rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-ink" aria-label="{order.unreadMessages} unread">{order.unreadMessages}</span>
						{/if}
					</Button>
				{/if}
			</section>
		{/if}

		{#if canWrite && ((paid && canVoid) || (roomCharged && canVoid) || (unpaid && order.status !== 'served'))}
			<section class="flex flex-wrap gap-2 border-t border-border pt-3" aria-label="Undo or cancel">
				{#if paid && canVoid}
					<Button variant="destructive" size="sm" class="h-10" onclick={() => onvoid(order)}>Void payment…</Button>
				{/if}
				{#if roomCharged && canVoid}
					<Button variant="destructive" size="sm" class="h-10" onclick={() => onundoroom(order)}>Take off room bill…</Button>
				{/if}
				{#if unpaid && order.status !== 'served'}
					<Button variant="destructive" size="sm" class="h-10" onclick={() => oncancel(order)}>Cancel order…</Button>
				{/if}
			</section>
		{/if}
	</footer>
</article>
