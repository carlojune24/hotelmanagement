<script lang="ts">
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const base = $derived(`/${page.params.hotel}/finance/paymongo`);

	const peso = (c: number) =>
		`₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	const purposeLabel: Record<string, string> = {
		deposit: 'Deposit',
		settlement: 'Settlement',
		balance: 'Balance',
		refund: 'Refund'
	};

	function statusVariantClass(status: string): string {
		if (status === 'paid') return 'border-transparent bg-ok/15 text-ok';
		if (status === 'failed') return 'border-transparent bg-danger/15 text-danger';
		return 'border-border bg-surface-2 text-ink-muted';
	}

	const statusFilters = [
		{ v: 'all', label: 'All statuses' },
		{ v: 'paid', label: 'Paid' },
		{ v: 'pending', label: 'Pending' },
		{ v: 'failed', label: 'Failed' }
	];
	const typeFilters = [
		{ v: 'all', label: 'All types' },
		{ v: 'settlement', label: 'Payments' },
		{ v: 'refund', label: 'Refunds' }
	];

	function filterHref(next: { status?: string; type?: string }) {
		const params = new URLSearchParams();
		const status = next.status ?? data.status;
		const type = next.type ?? data.purpose;
		if (status !== 'all') params.set('status', status);
		if (type !== 'all') params.set('type', type);
		const qs = params.toString();
		return qs ? `${base}?${qs}` : base;
	}

	let detail = $state<(typeof data.transactions)[number] | null>(null);
</script>

<div class="p-4 sm:p-6">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-lg font-semibold text-ink">PayMongo transactions</h1>
			<p class="text-sm text-ink-muted">
				Every online payment and refund that touched PayMongo, with what actually happened to each —
				click a row for the raw webhook payload.
			</p>
		</div>
	</div>

	<div class="mb-3 flex flex-wrap gap-4">
		<div class="flex gap-1">
			{#each statusFilters as f (f.v)}
				<a
					href={filterHref({ status: f.v })}
					class="rounded-md px-2.5 py-1 text-xs font-medium {data.status === f.v
						? 'bg-surface-2 text-ink'
						: 'text-ink-muted hover:text-ink'}"
				>
					{f.label}
				</a>
			{/each}
		</div>
		<div class="flex gap-1">
			{#each typeFilters as f (f.v)}
				<a
					href={filterHref({ type: f.v })}
					class="rounded-md px-2.5 py-1 text-xs font-medium {data.purpose === f.v
						? 'bg-surface-2 text-ink'
						: 'text-ink-muted hover:text-ink'}"
				>
					{f.label}
				</a>
			{/each}
		</div>
	</div>

	{#if data.transactions.length === 0}
		<p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
			No PayMongo transactions match this filter.
		</p>
	{:else}
		<div class="overflow-x-auto rounded-xl border border-border">
			<table class="w-full text-sm">
				<thead class="border-b border-border bg-surface-2 text-left text-xs text-ink-muted">
					<tr>
						<th class="px-3 py-2">Type</th>
						<th class="px-3 py-2">Status</th>
						<th class="px-3 py-2">Guest</th>
						<th class="px-3 py-2 text-right">Amount</th>
						<th class="px-3 py-2">PayMongo ID</th>
						<th class="px-3 py-2">Date</th>
					</tr>
				</thead>
				<tbody>
					{#each data.transactions as t (t.id)}
						<tr
							class="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2"
							onclick={() => (detail = t)}
						>
							<td class="px-3 py-2">{purposeLabel[t.purpose] ?? t.purpose}</td>
							<td class="px-3 py-2"
								><Badge variant="outline" class={statusVariantClass(t.status)}>{t.status}</Badge
								></td
							>
							<td class="px-3 py-2">{t.guestName ?? '—'}</td>
							<td
								class="px-3 py-2 text-right font-mono {t.purpose === 'refund'
									? 'text-danger'
									: 'text-ink'}"
							>
								{t.purpose === 'refund' ? '−' : ''}{peso(t.amountCentavos)}
							</td>
							<td class="px-3 py-2 font-mono text-xs text-ink-muted">
								{(t.purpose === 'refund' ? t.paymongoRefundId : t.paymongoPaymentId) ?? '—'}
							</td>
							<td class="px-3 py-2 text-ink-muted">
								{new Date(t.paidAt ?? t.createdAt).toLocaleString('en-PH', {
									dateStyle: 'medium',
									timeStyle: 'short'
								})}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<Dialog.Root
	open={!!detail}
	onOpenChange={(v) => {
		if (!v) detail = null;
	}}
>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-lg">
		{#if detail}
			<Dialog.Header>
				<Dialog.Title
					>{purposeLabel[detail.purpose] ?? detail.purpose} — {detail.status}</Dialog.Title
				>
				<Dialog.Description
					>{detail.guestName ?? 'Unknown guest'} · {peso(detail.amountCentavos)}</Dialog.Description
				>
			</Dialog.Header>
			<dl class="space-y-1.5 text-sm">
				<div class="flex justify-between gap-3">
					<dt class="text-ink-muted">Order</dt>
					<dd class="font-mono text-xs">{detail.orderId}</dd>
				</div>
				{#if detail.paymongoPaymentId}
					<div class="flex justify-between gap-3">
						<dt class="text-ink-muted">Payment ID</dt>
						<dd class="font-mono text-xs">{detail.paymongoPaymentId}</dd>
					</div>
				{/if}
				{#if detail.paymongoRefundId}
					<div class="flex justify-between gap-3">
						<dt class="text-ink-muted">Refund ID</dt>
						<dd class="font-mono text-xs">{detail.paymongoRefundId}</dd>
					</div>
				{/if}
				{#if detail.paymongoCheckoutSessionId}
					<div class="flex justify-between gap-3">
						<dt class="text-ink-muted">Checkout session</dt>
						<dd class="font-mono text-xs">{detail.paymongoCheckoutSessionId}</dd>
					</div>
				{/if}
				{#if detail.paymongoEventId}
					<div class="flex justify-between gap-3">
						<dt class="text-ink-muted">Webhook event</dt>
						<dd class="font-mono text-xs">{detail.paymongoEventId}</dd>
					</div>
				{/if}
			</dl>
			{#if detail.rawPayload}
				<div>
					<p class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
						Raw webhook payload
					</p>
					<pre
						class="max-h-64 overflow-auto rounded-md border border-border bg-surface-2 p-2.5 text-[11px] text-ink">{JSON.stringify(
							detail.rawPayload,
							null,
							2
						)}</pre>
				</div>
			{:else}
				<p class="text-xs text-ink-muted">No raw payload recorded for this row.</p>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
