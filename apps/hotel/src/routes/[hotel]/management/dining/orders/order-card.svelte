<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
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

	<footer class="mt-3 space-y-2.5 border-t border-border pt-2.5">
		<div class="flex items-center justify-between gap-2">
			<span class="font-medium tabular-nums text-ink">{peso(order.totalCentavos)}</span>
			{#if unpaid}
				<Badge variant="outline">Unpaid</Badge>
			{:else if roomCharged}
				<Badge variant="secondary">Room {order.roomLabel ?? ''}</Badge>
			{:else}
				<Badge variant="secondary">Paid · {METHOD[order.paymentMethod ?? ''] ?? order.paymentMethod ?? ''}</Badge>
			{/if}
		</div>

		{#if receipt || invoice}
			<p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
				<ReceiptTextIcon class="size-3.5" aria-hidden="true" />
				{#if receipt}<a class="underline" href="/{slug}/print/receipt/{receipt.id}" target="_blank" rel="noopener">Receipt {receipt.formattedNo}</a>{/if}
				{#if invoice}<a class="underline" href="/{slug}/print/invoice/{invoice.id}" target="_blank" rel="noopener">Invoice {invoice.formattedNo}</a>{/if}
			</p>
		{/if}

		{#if canWrite}
			<div class="flex items-center gap-2">
				{#if next}
					<Button size="sm" class="h-10 flex-1" variant={unpaid && order.status === 'served' ? 'outline' : 'default'} onclick={() => onadvance(order, next)}>
						{NEXT_LABEL[next]}
					</Button>
				{/if}
				{#if unpaid}
					<Button size="sm" variant={next ? 'outline' : 'default'} class={next ? 'h-10' : 'h-10 flex-1'} onclick={() => onpay(order)}>Take payment</Button>
				{/if}
				{#if hasThread}
					<Button variant="ghost" size="icon" class="relative size-10 shrink-0" aria-label={order.unreadMessages > 0 ? `${order.unreadMessages} unread messages for ${order.code}` : `Messages for ${order.code}`} onclick={() => ontalk(order)}>
						<MessageSquareIcon class="size-4" />
						{#if order.unreadMessages > 0}
							<span class="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-brand-ink">{order.unreadMessages}</span>
						{/if}
					</Button>
				{/if}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon" class="size-10 shrink-0" aria-label="More actions for {order.code}">
								<EllipsisIcon class="size-4" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						{#if !receipt && paid}
							<DropdownMenu.Item onSelect={() => onissuereceipt(order)}>Issue official receipt</DropdownMenu.Item>
						{/if}
						{#if !invoice && !roomCharged}
							<DropdownMenu.Item onSelect={() => oninvoice(order)}>Issue invoice…</DropdownMenu.Item>
						{/if}
						{#if paid && canVoid}
							<DropdownMenu.Item variant="destructive" onSelect={() => onvoid(order)}>Void payment…</DropdownMenu.Item>
						{/if}
						{#if roomCharged && canVoid}
							<DropdownMenu.Item variant="destructive" onSelect={() => onundoroom(order)}>Take off room bill…</DropdownMenu.Item>
						{/if}
						{#if unpaid && order.status !== 'served'}
							<DropdownMenu.Separator />
							<DropdownMenu.Item variant="destructive" onSelect={() => oncancel(order)}>Cancel order…</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		{/if}
	</footer>
</article>
