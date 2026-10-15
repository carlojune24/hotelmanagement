<script lang="ts">
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/${page.params.hotel}/management/finance/reconciliation`);
	const staff = $derived(`/${page.params.hotel}/management`);
	const peso = (c: number) => `₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const when = (d: Date | string | null) =>
		d
			? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'medium', timeZone: data.timezone }).format(new Date(d))
			: '—';
	const dur = (ms: number | null) => {
		if (ms == null) return '—';
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s} sec`;
		if (s < 3600) return `${Math.round(s / 60)} min`;
		if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
		return `${(s / 86400).toFixed(1)} d`;
	};
	const orderHref = (r: { scope: 'room' | 'dining'; orderId: string | null }) =>
		!r.orderId ? null : r.scope === 'room' ? `${staff}/transactions/${r.orderId}` : `${staff}/dining/orders`;

	const KIND: Record<string, { label: string; cls: string }> = {
		cannot_verify: { label: 'Cannot verify', cls: 'border-transparent bg-warning/20 text-ink' },
		not_recorded: { label: 'Paid, not recorded', cls: 'border-transparent bg-danger/15 text-danger' },
		refund_due: { label: 'Refund due', cls: 'border-transparent bg-danger/15 text-danger' },
		untrailed: { label: 'Not on the trail', cls: 'border-transparent bg-danger/15 text-danger' }
	};
	const FOUND_BY: Record<string, string> = {
		guest_page: "The guest's confirmation page (asked PayMongo on load)",
		worker: 'The background check that runs every minute',
		webhook: 'A later PayMongo webhook that prompted a check',
		hold_sweep: 'The booking-hold sweep, before it would have cancelled',
		backfill: 'Imported: recorded before the money trail existed (time taken from the payment record)'
	};
	const FOUND_SHORT: Record<string, string> = {
		guest_page: 'Guest page',
		worker: 'Every-minute check',
		webhook: 'Webhook check',
		hold_sweep: 'Hold sweep',
		backfill: 'Imported'
	};
	const EVENT_LABEL: Record<string, string> = {
		reconciled: 'Reconciled',
		reconcile_failed: 'Could not record',
		amount_mismatch: 'Amount differs',
		paid_after_cancel: 'Paid after cancel'
	};
	const STATUS: Record<string, string> = { pending_payment: 'awaiting payment', confirmed: 'confirmed', cancelled: 'cancelled' };
	const status = (s: string | null) => (s ? (STATUS[s] ?? s.replace(/_/g, ' ')) : '—');
	const short = (h: string | null) => (h ? `${h.slice(0, 10)}…` : '—');

	let open = $state<Record<string, boolean>>({});

	const exportHref = $derived.by(() => {
		const p = new URLSearchParams();
		if (data.filter.from) p.set('from', data.filter.from);
		if (data.filter.to) p.set('to', data.filter.to);
		if (data.filter.scope !== 'all') p.set('scope', data.filter.scope);
		return `${base}/export?${p.toString()}`;
	});
</script>

<svelte:head><title>Reconciliation · Finance</title></svelte:head>

<div class="mx-auto w-full max-w-7xl p-4 sm:p-6">
	<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-lg font-semibold text-ink">Reconciliation</h1>
			<p class="mt-1 max-w-2xl text-sm text-ink-muted">
				Where PayMongo and our books disagreed, and how it ended. When a guest paid but PayMongo's webhook never reached us, the
				system asks PayMongo itself every minute and records the payment. Each one it settled is kept on a tamper-evident trail.
			</p>
		</div>
		<div class="flex gap-2 print:hidden">
			<Button size="sm" variant="outline" onclick={() => window.print()}>
				<PrinterIcon class="size-4" aria-hidden="true" /> Print
			</Button>
			<Button size="sm" variant="outline" href={exportHref} data-sveltekit-reload>
				<DownloadIcon class="size-4" aria-hidden="true" /> CSV
			</Button>
		</div>
	</div>

	<!-- Integrity of the money trail -->
	{#if data.integrity.ok}
		<p class="mb-4 flex items-start gap-2 rounded-lg border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ink">
			<ShieldCheckIcon class="mt-0.5 size-4 shrink-0 text-ok" aria-hidden="true" />
			<span>
				<strong>Money trail verified.</strong>
				{data.integrity.events === 0
					? 'No events yet.'
					: `All ${data.integrity.events} events re-checked just now: none changed, none removed, none out of order.`}
				{#if data.integrity.headHash}
					<span class="mt-0.5 block font-mono text-xs break-all text-ink-muted">
						Latest #{data.integrity.headSeq} · {data.integrity.headHash}
					</span>
				{/if}
			</span>
		</p>
	{:else}
		<p class="mb-4 flex items-start gap-2 rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-ink">
			<ShieldAlertIcon class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
			<span>
				<strong>The money trail does not check out.</strong>
				Entry #{data.integrity.problem?.seq} {data.integrity.problem?.reason === 'hash_mismatch'
					? 'was changed after it was written'
					: data.integrity.problem?.reason === 'gap'
						? 'is out of sequence: an earlier entry is missing'
						: 'does not link to the entry before it'}. Do not rely on this report; tell the owner and the developer now.
			</span>
		</p>
	{/if}

	<section aria-label="Summary" class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<div class="rounded-xl border p-4 {data.issues.length > 0 ? 'border-danger/40 bg-danger/5' : 'border-border'}">
			<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Needs attention</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums text-ink">{data.issues.length}</p>
			<p class="text-xs text-ink-muted">{data.issues.length === 0 ? 'Nothing is waiting on you.' : 'Open cases below.'}</p>
		</div>
		<div class="rounded-xl border p-4 {data.settledTotals.mismatches > 0 ? 'border-danger/40 bg-danger/5' : 'border-border'}">
			<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Settled automatically</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums text-ink">{data.settledTotals.count}</p>
			<p class="text-xs text-ink-muted">
				{peso(data.settledTotals.amountCentavos)} in the period.
				{#if data.settledTotals.mismatches > 0}<span class="text-danger">{data.settledTotals.mismatches} with an amount that differs.</span>{/if}
			</p>
		</div>
		<div class="rounded-xl border border-border p-4">
			<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Missing for (average)</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums text-ink">{dur(data.settledTotals.avgMissingMs)}</p>
			<p class="text-xs text-ink-muted">Longest {dur(data.settledTotals.maxMissingMs)}. PayMongo paid to us recording it.</p>
		</div>
		<div class="rounded-xl border border-border p-4">
			<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Waiting on a guest</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums text-ink">{data.waitingOnGuest}</p>
			<p class="text-xs text-ink-muted">Checkout links not paid yet. Not a discrepancy.</p>
		</div>
	</section>

	<!-- Needs attention -->
	<section class="mb-8" aria-label="Needs attention">
		<h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
			<TriangleAlertIcon class="size-4 text-danger" aria-hidden="true" /> Needs attention
		</h2>
		{#if data.issues.length === 0}
			<p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
				No open discrepancies. Every payment PayMongo has reported is in the books.
			</p>
		{:else}
			<div class="divide-y divide-border rounded-xl border border-border">
				{#each data.issues as r (r.kind + r.orderId + r.paymongoId)}
					<div class="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-1.5">
								<Badge variant="outline" class={KIND[r.kind]?.cls}>{KIND[r.kind]?.label ?? r.kind}</Badge>
								<a href={orderHref(r)} class="font-medium text-brand underline underline-offset-2">{r.orderCode}</a>
								<span class="text-xs text-ink-muted">{r.scope === 'room' ? 'Booking' : 'Dining'}</span>
								{#if r.guestName}<span class="text-sm text-ink">{r.guestName}</span>{/if}
							</div>
							<p class="mt-1 text-sm text-ink">{r.detail}</p>
							<p class="mt-0.5 font-mono text-xs break-all text-ink-muted">
								{r.paymongoId ?? ''}{#if r.attemptCode} · {r.attemptCode}{/if}
							</p>
							<p class="mt-0.5 text-xs text-ink-muted">
								Since {when(r.since)}{#if r.checks != null} · checked {r.checks}×{/if}{#if r.nextCheckAt && r.kind !== 'refund_due'} · next check {when(r.nextCheckAt)}{/if}
							</p>
						</div>
						<div class="text-right text-sm font-semibold tabular-nums text-ink">{peso(r.amountCentavos)}</div>
					</div>
				{/each}
			</div>
			<p class="mt-2 text-xs text-ink-muted">
				"Cannot verify" and "paid, not recorded" retry on their own until PayMongo answers; no action is needed unless one stays for
				hours. A refund is made from the booking.
			</p>
		{/if}
	</section>

	<!-- Settled -->
	<section class="mb-8" aria-label="Settled">
		<div class="mb-2 flex flex-wrap items-end justify-between gap-3">
			<h2 class="flex items-center gap-2 text-sm font-semibold text-ink">
				<CircleCheckIcon class="size-4 text-ok" aria-hidden="true" /> Settled automatically
			</h2>
			<form method="GET" class="flex flex-wrap items-end gap-2 print:hidden">
				<label class="text-xs text-ink-muted">
					From
					<Input type="date" name="from" value={data.filter.from ?? ''} class="mt-0.5 h-8 w-36" />
				</label>
				<label class="text-xs text-ink-muted">
					To
					<Input type="date" name="to" value={data.filter.to ?? ''} class="mt-0.5 h-8 w-36" />
				</label>
				<label class="text-xs text-ink-muted">
					Type
					<select name="scope" class="mt-0.5 h-8 rounded-md border border-border bg-surface px-2 text-sm text-ink">
						<option value="all" selected={data.filter.scope === 'all'}>All</option>
						<option value="room" selected={data.filter.scope === 'room'}>Bookings</option>
						<option value="dining" selected={data.filter.scope === 'dining'}>Dining</option>
					</select>
				</label>
				<Button type="submit" size="sm" variant="outline">Apply</Button>
			</form>
		</div>
		{#if data.settled.length === 0}
			<p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
				Nothing was settled this way in this period. Webhooks are arriving as they should.
			</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-border">
				<table class="w-full min-w-[60rem] text-left text-sm">
					<thead class="bg-surface-2 text-xs tracking-wide text-ink-muted uppercase">
						<tr>
							<th class="px-3 py-2 font-semibold">#</th>
							<th class="px-3 py-2 font-semibold">Reconciled</th>
							<th class="px-3 py-2 font-semibold">Booking / dining</th>
							<th class="px-3 py-2 text-right font-semibold">Amount</th>
							<th class="px-3 py-2 font-semibold">PayMongo payment</th>
							<th class="px-3 py-2 text-right font-semibold">Missing for</th>
							<th class="px-3 py-2 font-semibold print:hidden"><span class="sr-only">Details</span></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each data.settled as s (s.eventId)}
							<tr class="align-top">
								<td class="px-3 py-2 font-mono text-xs text-ink-muted">{s.seq}</td>
								<td class="px-3 py-2 whitespace-nowrap text-ink">
									{when(s.reconciledAt)}
									<div class="text-xs text-ink-muted">{FOUND_SHORT[s.trigger] ?? s.trigger}</div>
								</td>
								<td class="px-3 py-2">
									<div class="flex flex-wrap items-center gap-1">
										{#if orderHref(s)}
											<a href={orderHref(s)} class="font-medium text-brand underline underline-offset-2">{s.orderCode}</a>
										{:else}
											<span class="font-medium text-ink">{s.orderCode}</span>
										{/if}
										<span class="text-xs text-ink-muted">{s.scope === 'room' ? 'Booking' : 'Dining'}</span>
									</div>
									<div class="text-ink">{s.guestName ?? '—'}</div>
								</td>
								<td class="px-3 py-2 text-right tabular-nums text-ink">
									{peso(s.amountCentavos)}
									{#if s.amountMismatch}
										<div class="text-xs text-danger">asked {peso(s.expectedAmountCentavos ?? 0)}</div>
									{/if}
									{#if s.paidAfterCancel}
										<div class="text-xs text-danger">paid after cancel</div>
									{/if}
								</td>
								<td class="px-3 py-2">
									<div class="font-mono text-xs break-all text-ink">{s.paymongoPaymentId}</div>
									{#if s.paymentIntentId}<div class="font-mono text-xs break-all text-ink-muted">{s.paymentIntentId}</div>{/if}
								</td>
								<td class="px-3 py-2 text-right whitespace-nowrap text-ink-muted">{dur(s.missingMs)}</td>
								<td class="px-3 py-2 text-right print:hidden">
									<button
										type="button"
										class="inline-flex items-center gap-1 text-xs text-brand underline underline-offset-2"
										aria-expanded={!!open[s.eventId]}
										onclick={() => (open[s.eventId] = !open[s.eventId])}
									>
										Details <ChevronDownIcon class="size-3.5 transition-transform {open[s.eventId] ? 'rotate-180' : ''}" aria-hidden="true" />
									</button>
								</td>
							</tr>
							<tr class="bg-surface-2/50 {open[s.eventId] ? '' : 'hidden print:table-row'}">
								<td colspan="7" class="px-4 py-3">
									<div class="grid gap-4 lg:grid-cols-2">
										<!-- What happened, in order -->
										<ol class="space-y-2 border-l-2 border-border pl-4 text-sm">
											<li>
												<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Guest started the checkout</p>
												<p class="text-ink">{when(s.attemptStartedAt)}</p>
											</li>
											<li>
												<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">PayMongo took the payment</p>
												<p class="text-ink">{when(s.paymongoPaidAt)}</p>
											</li>
											<li>
												<p class="text-xs font-semibold tracking-wide text-danger uppercase">Missing from our books</p>
												<p class="text-ink">The webhook never arrived. Missing for {dur(s.missingMs)}.</p>
											</li>
											<li>
												<p class="text-xs font-semibold tracking-wide text-ok uppercase">Found and recorded</p>
												<p class="text-ink">{when(s.reconciledAt)}</p>
												<p class="text-xs text-ink-muted">By the system (no staff action). Found by: {FOUND_BY[s.trigger] ?? s.trigger}.</p>
											</li>
										</ol>
										<!-- The facts -->
										<dl class="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
											<dt class="text-ink-muted">Amount received</dt>
											<dd class="tabular-nums text-ink">{peso(s.amountCentavos)}</dd>
											<dt class="text-ink-muted">Amount asked</dt>
											<dd class="tabular-nums {s.amountMismatch ? 'font-semibold text-danger' : 'text-ink'}">
												{s.expectedAmountCentavos == null ? '—' : peso(s.expectedAmountCentavos)}{s.amountMismatch ? ' (differs)' : s.expectedAmountCentavos != null ? ' (matches)' : ''}
											</dd>
											<dt class="text-ink-muted">Booking status</dt>
											<dd class="text-ink">{s.backfilled ? "not captured (imported)" : `${status(s.orderStatusBefore)} → ${status(s.orderStatusAfter)}`}</dd>
											<dt class="text-ink-muted">Paid with</dt>
											<dd class="text-ink">{s.method ?? (s.backfilled ? "not captured (imported)" : '—')}</dd>
											<dt class="text-ink-muted">Times checked</dt>
											<dd class="text-ink">{s.checks ?? '—'}</dd>
											<dt class="text-ink-muted">Check code</dt>
											<dd class="font-mono text-xs text-ink">{s.attemptCode ?? '—'}</dd>
											<dt class="text-ink-muted">Payment ID</dt>
											<dd class="font-mono text-xs break-all text-ink">{s.paymongoPaymentId}</dd>
											<dt class="text-ink-muted">Payment intent</dt>
											<dd class="font-mono text-xs break-all text-ink">{s.paymentIntentId ?? '—'}</dd>
											<dt class="text-ink-muted">Checkout session</dt>
											<dd class="font-mono text-xs break-all text-ink">{s.checkoutSessionId ?? '—'}</dd>
											<dt class="text-ink-muted">Our payment record</dt>
											<dd class="font-mono text-xs break-all text-ink">{s.paymentRowId ?? '—'}</dd>
											<dt class="text-ink-muted">Trail entry</dt>
											<dd class="font-mono text-xs break-all text-ink">#{s.seq} · {s.rowHash}</dd>
											<dt class="text-ink-muted">Follows entry</dt>
											<dd class="font-mono text-xs break-all text-ink-muted">{s.prevHash ?? 'first entry'}</dd>
										</dl>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
		<p class="mt-2 text-xs text-ink-muted">
			Does PayMongo's own list match our books? That check, with refunds and payouts, is on the
			<a href="/{page.params.hotel}/management/finance/paymongo" class="text-brand underline underline-offset-2">PayMongo tab</a>.
		</p>
	</section>

	<!-- The full trail -->
	<section aria-label="Money trail">
		<h2 class="mb-1 text-sm font-semibold text-ink">Money trail</h2>
		<p class="mb-2 max-w-3xl text-xs text-ink-muted">
			Every reconciliation event, newest first. Entries can only be added: the database refuses to change or delete them, and each
			carries a fingerprint of itself and the one before, so any edit made around that shows up as a broken chain above.
		</p>
		<div class="overflow-x-auto rounded-xl border border-border">
			<table class="w-full min-w-[52rem] text-left text-xs">
				<thead class="bg-surface-2 tracking-wide text-ink-muted uppercase">
					<tr>
						<th class="px-3 py-2 font-semibold">#</th>
						<th class="px-3 py-2 font-semibold">When</th>
						<th class="px-3 py-2 font-semibold">Event</th>
						<th class="px-3 py-2 font-semibold">Booking / dining</th>
						<th class="px-3 py-2 text-right font-semibold">Amount</th>
						<th class="px-3 py-2 font-semibold">PayMongo payment</th>
						<th class="px-3 py-2 font-semibold">Found by</th>
						<th class="px-3 py-2 font-semibold">Fingerprint</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border">
					{#each data.trail as t (t.seq)}
						<tr class="align-top">
							<td class="px-3 py-1.5 font-mono text-ink-muted">{t.seq}</td>
							<td class="px-3 py-1.5 whitespace-nowrap text-ink">{when(t.at)}</td>
							<td class="px-3 py-1.5 text-ink">
								{EVENT_LABEL[t.eventType] ?? t.eventType}
								{#if t.error}<div class="text-danger">{t.error}</div>{/if}
							</td>
							<td class="px-3 py-1.5 text-ink">{t.orderCode} <span class="text-ink-muted">{t.scope === 'room' ? 'Booking' : 'Dining'}</span></td>
							<td class="px-3 py-1.5 text-right tabular-nums text-ink">{peso(t.amountCentavos)}</td>
							<td class="px-3 py-1.5 font-mono break-all text-ink-muted">{t.paymongoPaymentId ?? '—'}</td>
							<td class="px-3 py-1.5 text-ink-muted">{FOUND_SHORT[t.trigger] ?? t.trigger}</td>
							<td class="px-3 py-1.5 font-mono text-ink-muted" title={t.rowHash}>{short(t.rowHash)}</td>
						</tr>
					{:else}
						<tr><td colspan="8" class="px-3 py-6 text-center text-ink-muted">No events in this period.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
