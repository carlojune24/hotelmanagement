<script lang="ts">
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import BedDoubleIcon from '@lucide/svelte/icons/bed-double';
	import { METHOD_LABEL } from '$lib/dining-report-doc';
	import { DOCUMENT_TYPE_LABEL, batchPrintHref } from '$lib/print-batch';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const slug = $derived(page.params.hotel ?? '');
	const staffBase = $derived(`/${slug}/management`);
	const r = $derived(data.reservation);
	const t = $derived(data.totals);
	const tz = $derived(data.timezone);

	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const fmtWhen = (iso: string) =>
		new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));
	const fmtTime = (iso: string) => new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso));

	const STATUS: Record<string, { label: string; cls: string }> = {
		pending: { label: 'Awaiting payment', cls: 'border-transparent bg-warning/15 text-ink' },
		confirmed: { label: 'Reserved', cls: 'border-border text-ink' },
		seated: { label: 'Seated', cls: 'border-transparent bg-brand/15 text-ink' },
		completed: { label: 'Done', cls: 'border-border bg-surface-2 text-ink-muted' },
		no_show: { label: 'No-show', cls: 'border-transparent bg-danger/15 text-danger' },
		cancelled: { label: 'Cancelled', cls: 'border-transparent bg-danger/15 text-danger' }
	};
	const ORDER_STATUS: Record<string, string> = {
		pending_payment: 'Awaiting payment',
		pending_acceptance: 'Waiting to be accepted',
		new: 'New',
		accepted: 'Accepted',
		preparing: 'In the kitchen',
		ready: 'Ready',
		served: 'Served',
		cancelled: 'Cancelled'
	};
	const payState = $derived(
		t.refundDueCentavos > 0
			? { label: `Refund due ${peso(t.refundDueCentavos)}`, cls: 'border-transparent bg-danger/15 text-danger' }
			: t.unpaidCentavos > 0
				? { label: `${peso(t.unpaidCentavos)} unpaid`, cls: 'border-transparent bg-warning/15 text-ink' }
				: t.paidCentavos > 0
					? { label: 'Paid', cls: 'border-transparent bg-ok/15 text-ink' }
					: { label: 'No pre-order', cls: 'border-border bg-surface-2 text-ink-muted' }
	);
	const method = (m: string | null) => (m ? (METHOD_LABEL[m] ?? m.replace(/_/g, ' ')) : '—');
	const payMethod = (p: PageData['payments'][number]) =>
		p.kind === 'refund' ? method(p.method) : p.provider === 'paymongo' ? 'Online (PayMongo)' : method(p.method ?? p.provider);
</script>

<svelte:head><title>{r.code} · {r.guestName}</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6 p-6">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">{r.guestName}</h1>
			<p class="mt-1 font-mono text-sm text-ink">{r.code}</p>
			<p class="mt-2 text-sm text-ink-muted">{[r.guestPhone, r.guestEmail].filter(Boolean).join(' · ') || 'No contact details'}</p>
			<div class="mt-2 flex flex-wrap items-center gap-2">
				<Badge variant="outline" class={STATUS[r.status]?.cls}>{STATUS[r.status]?.label ?? r.status}</Badge>
				<Badge
					variant="outline"
					class={r.source === 'online' ? 'border-transparent bg-accent text-ink' : 'border-border bg-surface-2 text-ink-muted'}
					title={r.source === 'online' ? 'The guest booked on the website and paid the pre-order online.' : 'Taken by staff, by phone or at the door.'}
				>{r.source === 'online' ? 'Online' : 'Staff'}</Badge>
				<Badge variant="outline" class={payState.cls}>{payState.label}</Badge>
			</div>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Button variant="outline" size="sm" href="{staffBase}/trail/{r.code}">Trail</Button>
			{#each data.orders as o (o.id)}
				<Button variant="outline" size="sm" href="/{slug}/print/bill/order/{o.id}" target="_blank">Print bill{data.orders.length > 1 ? ` ${o.code}` : ''}</Button>
			{/each}
			<Button variant="outline" size="sm" href="{staffBase}/dining/reservations">← Reservations</Button>
		</div>
	</div>

	<div class="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
		<div class="min-w-0 space-y-6">
			<section class="rounded-lg border border-border">
				<h2 class="border-b border-border px-3 py-2.5 text-sm font-semibold text-ink">Booking</h2>
				<dl class="grid grid-cols-1 gap-x-6 gap-y-3 px-3 py-3 text-sm sm:grid-cols-2">
					<div><dt class="text-xs text-ink-muted">When</dt><dd class="text-ink">{fmtWhen(r.startsAt)} – {fmtTime(r.endsAt)}</dd></div>
					<div><dt class="text-xs text-ink-muted">Party</dt><dd class="tabular-nums text-ink">{r.partySize} {r.partySize === 1 ? 'guest' : 'guests'}</dd></div>
					<div><dt class="text-xs text-ink-muted">Venue</dt><dd class="text-ink">{r.venueTitle}</dd></div>
					<div><dt class="text-xs text-ink-muted">Table</dt><dd class="text-ink">{r.tables.join(', ') || 'Not assigned'}</dd></div>
					<div>
						<dt class="text-xs text-ink-muted">Booked</dt>
						<dd class="text-ink">{fmtWhen(r.createdAt)}{r.createdBy ? ` by ${r.createdBy}` : r.source === 'online' ? ' online by the guest' : ''}</dd>
					</div>
					{#if r.cancelledAt}
						<div><dt class="text-xs text-ink-muted">Cancelled</dt><dd class="text-danger">{fmtWhen(r.cancelledAt)}</dd></div>
					{/if}
					{#if r.bookingOrderId}
						<div>
							<dt class="text-xs text-ink-muted">In-house guest</dt>
							<dd>
								<a class="inline-flex items-center gap-1 text-ink underline-offset-2 hover:underline" href="{staffBase}/transactions/{r.bookingOrderId}">
									<BedDoubleIcon class="size-3.5" aria-hidden="true" />Room booking <span class="font-mono">{r.bookingOrderId.slice(0, 8).toUpperCase()}</span>
								</a>
							</dd>
						</div>
					{/if}
					{#if r.remarks}
						<div class="sm:col-span-2"><dt class="text-xs text-ink-muted">Guest's note</dt><dd class="text-ink">“{r.remarks}”</dd></div>
					{/if}
				</dl>
			</section>

			<section class="space-y-3">
				<h2 class="text-sm font-semibold text-ink">Pre-order</h2>
				{#each data.orders as o (o.id)}
					<div class="rounded-lg border border-border">
						<div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
							<p class="text-sm">
								<span class="font-mono font-semibold text-ink">{o.code}</span>
								<span class="text-ink-muted"> · {o.orderType === 'pre_order' ? 'Pre-order' : 'Ordered at the table'} · {fmtWhen(o.createdAt)}</span>
								<a href="{staffBase}/trail/{o.code}" class="ml-1 text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline">Trail</a>
							</p>
							<div class="flex flex-wrap gap-1.5">
								<Badge variant="outline" class={o.status === 'cancelled' ? 'border-transparent bg-danger/15 text-danger' : 'border-border text-ink'}>{ORDER_STATUS[o.status] ?? o.status}</Badge>
								<Badge
									variant="outline"
									class={o.paymentStatus === 'paid' && o.status === 'cancelled'
										? 'border-transparent bg-danger/15 text-danger'
										: o.paymentStatus === 'paid'
											? 'border-transparent bg-ok/15 text-ink'
											: 'border-transparent bg-warning/15 text-ink'}
								>
									{o.paymentStatus === 'paid' ? (o.status === 'cancelled' ? 'Paid · refund due' : `Paid · ${method(o.paymentMethod)}`) : o.paymentStatus === 'room_charged' ? 'On the room bill' : 'Unpaid'}
								</Badge>
							</div>
						</div>
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head class="w-14 text-right">Qty</Table.Head>
									<Table.Head>Dish</Table.Head>
									<Table.Head class="w-28 text-right">Each</Table.Head>
									<Table.Head class="w-28 text-right">Amount</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each o.lines as l (l.id)}
									<Table.Row>
										<Table.Cell class="text-right tabular-nums">{l.quantity}×</Table.Cell>
										<Table.Cell class="whitespace-normal">
											<span class="text-ink">{l.name}</span>
											{#if l.addons.length}<span class="block text-xs text-ink-muted">+ {l.addons.join(', ')}</span>{/if}
											{#if l.remarks}<span class="block text-xs text-ink-muted">“{l.remarks}”</span>{/if}
										</Table.Cell>
										<Table.Cell class="text-right tabular-nums text-ink-muted">{peso(l.unitCentavos)}</Table.Cell>
										<Table.Cell class="text-right tabular-nums">{peso(l.lineTotalCentavos)}</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
						<dl class="space-y-1 border-t border-border px-3 py-2.5 text-sm">
							<div class="flex justify-between text-ink-muted"><dt>VAT included</dt><dd class="tabular-nums">{peso(o.vatCentavos)}</dd></div>
							<div class="flex justify-between font-semibold text-ink"><dt>Total</dt><dd class="tabular-nums">{peso(o.totalCentavos)}</dd></div>
							{#if o.paidAt}
								<div class="flex justify-between text-xs text-ink-muted">
									<dt>Paid</dt>
									<dd>{fmtWhen(o.paidAt)} · {method(o.paymentMethod)}{o.paymentReferenceNo ? ` · ref ${o.paymentReferenceNo}` : ''}</dd>
								</div>
							{/if}
							{#if o.status === 'cancelled' && o.cancelReason}
								<div class="flex justify-between gap-4 text-xs text-danger"><dt>Cancelled</dt><dd class="text-right">{o.cancelReason}</dd></div>
							{/if}
							{#if o.remarks}<div class="text-xs text-ink-muted">Note: “{o.remarks}”</div>{/if}
						</dl>
					</div>
				{:else}
					<p class="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-ink-muted">No dishes were ordered with this booking.</p>
				{/each}
			</section>

			<section>
				<h2 class="mb-2 text-sm font-semibold text-ink">Payments</h2>
				{#if data.payments.length === 0}
					<p class="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-ink-muted">
						{data.orders.some((o) => o.paidAt) ? 'Paid at the restaurant; see each order above.' : 'No payments yet.'}
					</p>
				{:else}
					<div class="rounded-lg border border-border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head>When</Table.Head>
									<Table.Head>What</Table.Head>
									<Table.Head>Method</Table.Head>
									<Table.Head>Reference</Table.Head>
									<Table.Head class="text-right">Amount</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each data.payments as p (p.id)}
									<Table.Row class={p.status === 'failed' ? 'text-ink-muted' : ''}>
										<Table.Cell class="whitespace-nowrap text-xs">{fmtWhen(p.at)}</Table.Cell>
										<Table.Cell class="whitespace-normal">
											{p.kind === 'refund' ? 'Refund' : 'Payment'}
											<span class="font-mono text-xs text-ink-muted">{p.orderCode}</span>
											{#if p.status !== 'paid'}<Badge variant="outline" class="ml-1">{p.status}</Badge>{/if}
											{#if p.note}<span class="block text-xs text-ink-muted">{p.note}</span>{/if}
											{#if p.proofUrl}<a class="block text-xs underline" href={p.proofUrl} target="_blank" rel="noopener">Proof</a>{/if}
										</Table.Cell>
										<Table.Cell>{payMethod(p)}</Table.Cell>
										<Table.Cell class="max-w-40 truncate font-mono text-xs" title={p.reference ?? ''}>{p.reference ?? '—'}</Table.Cell>
										<Table.Cell class="text-right tabular-nums {p.kind === 'refund' ? 'text-danger' : ''}">{p.kind === 'refund' ? '−' : ''}{peso(p.amountCentavos)}</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</section>

			{#if data.receipts.length > 0}
				<section>
					<h2 class="mb-2 text-sm font-semibold text-ink">Receipts</h2>
					<ul class="divide-y divide-border rounded-lg border border-border text-sm">
						{#each data.receipts as d (d.id)}
							<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
								<span>
									<span class="text-ink">{DOCUMENT_TYPE_LABEL[d.type as keyof typeof DOCUMENT_TYPE_LABEL] ?? d.type}</span>
									<span class="font-mono text-ink">{d.formattedNo}</span>
									<span class="text-xs text-ink-muted"> · {d.orderCode} · {fmtWhen(d.issuedAt)}</span>
									{#if d.status !== 'issued'}<Badge variant="outline" class="ml-1 border-transparent bg-danger/15 text-danger">{d.status}</Badge>{/if}
								</span>
								<Button variant="ghost" size="sm" href={batchPrintHref(slug, [d.id])} target="_blank">Print</Button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>

		<aside class="space-y-3 rounded-lg border border-border p-4 lg:sticky lg:top-6">
			<h2 class="text-sm font-semibold text-ink">Summary</h2>
			<dl class="space-y-2 text-sm">
				<div class="flex justify-between"><dt class="text-ink-muted">Ordered</dt><dd class="tabular-nums text-ink">{peso(t.orderedCentavos)}</dd></div>
				<div class="flex justify-between"><dt class="text-ink-muted">Paid</dt><dd class="tabular-nums text-ink">{peso(t.paidCentavos)}</dd></div>
				{#if t.refundedCentavos > 0}
					<div class="flex justify-between"><dt class="text-ink-muted">Refunded</dt><dd class="tabular-nums text-danger">−{peso(t.refundedCentavos)}</dd></div>
				{/if}
				{#if t.unpaidCentavos > 0}
					<div class="flex justify-between font-semibold"><dt>Still to pay</dt><dd class="tabular-nums">{peso(t.unpaidCentavos)}</dd></div>
				{/if}
				{#if t.refundDueCentavos > 0}
					<div class="flex justify-between font-semibold text-danger"><dt>Refund due</dt><dd class="tabular-nums">{peso(t.refundDueCentavos)}</dd></div>
				{/if}
			</dl>
			<p class="border-t border-border pt-2 text-xs text-ink-muted">VAT included. Money for a table pre-order is paid online before the booking is confirmed.</p>
		</aside>
	</div>
</div>
