<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ArrowDownLeftIcon from '@lucide/svelte/icons/arrow-down-left';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management/finance/paymongo`);
	const peso = (c: number) =>
		`₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const tz = $derived(data.connected ? data.timezone : 'Asia/Manila');
	const when = (d: Date | string | null) =>
		d
			? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(d))
			: '—';
	const day = (d: Date | string | null) =>
		d ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: tz }).format(new Date(d)) : '—';
	const ago = (d: Date | string | null) => {
		if (!d) return 'never';
		const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
		if (s < 60) return 'just now';
		if (s < 3600) return `${Math.floor(s / 60)} min ago`;
		if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
		return `${Math.floor(s / 86400)} d ago`;
	};

	const KIND_LABEL: Record<string, string> = { payment: 'Payment', refund: 'Refund', payout: 'Payout' };
	const OK = ['paid', 'succeeded', 'deposited'];
	const BAD = ['failed', 'returned', 'cancelled'];
	const statusClass = (s: string) =>
		OK.includes(s)
			? 'border-transparent bg-ok/15 text-ok'
			: BAD.includes(s)
				? 'border-transparent bg-danger/15 text-danger'
				: 'border-border bg-surface-2 text-ink-muted';
	const statusLabel = (s: string) => s.replace(/_/g, ' ');
	const signed = (r: { direction: string; kind: string; grossCentavos: number; netCentavos: number }) =>
		r.direction === 'in' ? r.netCentavos : -(r.kind === 'refund' ? r.grossCentavos : r.netCentavos);

	// ---- filters: the chips are links, the rest is one GET form that keeps them
	function href(next: Record<string, string | undefined>) {
		if (!data.connected) return base;
		const f = data.filter;
		const p = new URLSearchParams();
		const merged: Record<string, string | undefined> = {
			dir: f.direction === 'all' ? undefined : f.direction,
			kind: f.kind === 'all' ? undefined : f.kind,
			status: f.status === 'all' ? undefined : f.status,
			from: f.from,
			to: f.to,
			q: f.q,
			recon: f.recon,
			...next
		};
		for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
		const qs = p.toString();
		return qs ? `${base}?${qs}` : base;
	}
	const exportHref = $derived(href({}).replace(base, `${base}/export`));

	// ---- sync: start, then poll until the server says it has finished
	let waiting = $state(false);
	let polls = 0;
	$effect(() => {
		if (!data.connected) return;
		const never = data.balance.lastSyncedAt === null && data.balance.lastError === null;
		if (!(data.syncing || waiting || never)) {
			polls = 0;
			return;
		}
		const t = setInterval(async () => {
			polls += 1;
			await invalidateAll();
			if (polls >= 40) {
				waiting = false;
				clearInterval(t);
			} else if (data.connected && !data.syncing && data.balance.lastSyncedAt) {
				waiting = false;
			}
		}, 3000);
		return () => clearInterval(t);
	});
	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	let detail = $state<(typeof data & { connected: true })['rows'][number] | null>(null);
	const copy = (text: string) => {
		void navigator.clipboard?.writeText(text).then(
			() => toast.success('Copied'),
			() => toast.error('Could not copy')
		);
	};
</script>

<svelte:head><title>PayMongo · Finance</title></svelte:head>

{#if !data.connected}
	<div class="mx-auto w-full max-w-3xl p-4 sm:p-6">
		<h1 class="text-lg font-semibold text-ink">PayMongo</h1>
		<div class="mt-4 rounded-xl border border-dashed border-border p-8 text-center">
			<p class="text-sm text-ink-muted">PayMongo is not connected for this hotel, so there is no money to show yet.</p>
			<a href="/{page.params.hotel}/management/settings/payments-email" class="mt-3 inline-block text-sm text-brand underline underline-offset-2">
				Connect PayMongo in Settings
			</a>
		</div>
	</div>
{:else}
	<div class="mx-auto w-full max-w-7xl p-4 sm:p-6">
		<!-- Header -->
		<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
			<div>
				<div class="flex flex-wrap items-center gap-2">
					<h1 class="text-lg font-semibold text-ink">PayMongo</h1>
					<Badge variant="outline" class={data.connection.mode === 'live' ? 'border-transparent bg-ok/15 text-ok' : 'border-transparent bg-warning/20 text-ink'}>
						{data.connection.mode === 'live' ? 'Live' : 'Test mode'}
					</Badge>
					<span class="font-mono text-xs text-ink-muted">{data.connection.keyHint}</span>
				</div>
				<p class="mt-1 text-sm text-ink-muted">
					The hotel's money in PayMongo, taken from PayMongo's own records, so there is no need to sign in to its dashboard.
				</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-xs text-ink-muted">
					{data.syncing || waiting ? 'Syncing with PayMongo…' : `Synced ${ago(data.balance.lastSyncedAt)}`}
				</span>
				<form
					method="POST"
					action="?/sync"
					use:enhance={() => {
						waiting = true;
						return async ({ result, update }) => {
							if (result.type !== 'success') waiting = false;
							await update({ reset: false });
						};
					}}
				>
					<Button type="submit" size="sm" variant="outline" disabled={data.syncing || waiting}>
						<RefreshCwIcon class="size-4 {data.syncing || waiting ? 'animate-spin' : ''}" aria-hidden="true" /> Sync now
					</Button>
				</form>
				<Button size="sm" variant="outline" href={exportHref} data-sveltekit-reload>
					<DownloadIcon class="size-4" aria-hidden="true" /> CSV
				</Button>
			</div>
		</div>

		{#if data.balance.lastError}
			<p class="mb-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-ink">
				<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
				<span>
					The last sync did not finish: {data.balance.lastError}
					{#if data.balance.lastSyncedAt}The figures below are from {when(data.balance.lastSyncedAt)}.{/if}
				</span>
			</p>
		{/if}

		<!-- Balance -->
		<section aria-label="PayMongo balance" class="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{#if data.balance.wallet}
				<div class="rounded-xl border border-brand/40 bg-brand/5 p-4 sm:col-span-2 lg:col-span-4">
					<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">PayMongo wallet balance</p>
					<p class="mt-1 text-2xl font-semibold tabular-nums text-ink">{peso(data.balance.wallet.availableCentavos ?? 0)}</p>
					<p class="text-xs text-ink-muted">
						As PayMongo reports it{data.balance.wallet.pendingCentavos != null ? ` · pending ${peso(data.balance.wallet.pendingCentavos)}` : ''} · wallet {data.balance.wallet.id}
					</p>
				</div>
			{/if}
			<div class="rounded-xl border border-border p-4">
				<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Available</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums text-ink">{peso(data.balance.availableCentavos)}</p>
				<p class="text-xs text-ink-muted">
					Ready for the next payout{data.balance.nextCreditAt ? `, scheduled ${day(data.balance.nextCreditAt)}` : ''}.
					{#if data.balance.refundsSincePayoutCentavos > 0}After {peso(data.balance.refundsSincePayoutCentavos)} of refunds.{/if}
				</p>
			</div>
			<div class="rounded-xl border border-border p-4">
				<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Pending</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums text-ink">{peso(data.balance.pendingCentavos)}</p>
				<p class="text-xs text-ink-muted">Paid, still inside PayMongo's hold. Not available yet.</p>
			</div>
			<div class="rounded-xl border border-border p-4">
				<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">On the way to the bank</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums text-ink">{peso(data.balance.onTheWayCentavos)}</p>
				<p class="text-xs text-ink-muted">Payouts created, not yet deposited.</p>
			</div>
			<div class="rounded-xl border border-border p-4">
				<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Paid out, last 30 days</p>
				<p class="mt-1 text-2xl font-semibold tabular-nums text-ink">{peso(data.balance.paidOut30dCentavos)}</p>
				<p class="text-xs text-ink-muted">Deposited to the bank.</p>
			</div>
		</section>
		{#if !data.balance.wallet}
			<p class="mb-5 text-xs text-ink-muted">
				PayMongo does not publish an account balance to API keys, so Available and Pending are worked out from its payments, refunds and
				payouts the way its dashboard does. Compare them with the dashboard once; they should agree.
			</p>
		{:else}
			<div class="mb-5"></div>
		{/if}

		<!-- Does PayMongo agree with our records? -->
		{#if data.recon.unlinkedPayments > 0 || data.recon.missingInPaymongo.count > 0}
			<div class="mb-5 flex flex-wrap gap-2">
				{#if data.recon.unlinkedPayments > 0}
					<a
						href={href({ recon: 'unlinked', dir: 'in', kind: 'payment' })}
						class="inline-flex items-center gap-1.5 rounded-full border border-warning/50 bg-warning/15 px-3 py-1 text-xs text-ink hover:bg-warning/25"
					>
						<TriangleAlertIcon class="size-3.5" aria-hidden="true" />
						{data.recon.unlinkedPayments} PayMongo payment{data.recon.unlinkedPayments === 1 ? '' : 's'} not linked to a booking
					</a>
				{/if}
				{#if data.recon.missingInPaymongo.count > 0}
					<span class="inline-flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-3 py-1 text-xs text-ink" title={data.recon.missingInPaymongo.items.map((i) => i.paymongoId).join(', ')}>
						<TriangleAlertIcon class="size-3.5" aria-hidden="true" />
						{data.recon.missingInPaymongo.count} online payment{data.recon.missingInPaymongo.count === 1 ? '' : 's'} we recorded are missing in PayMongo
					</span>
				{/if}
				{#if data.filter.recon}
					<a href={href({ recon: undefined, dir: undefined, kind: undefined })} class="text-xs text-ink-muted underline underline-offset-2">Clear this filter</a>
				{/if}
			</div>
		{/if}

		<!-- Filters -->
		<div class="mb-3 flex flex-wrap items-end gap-x-6 gap-y-3">
			<div class="flex gap-1" role="group" aria-label="Direction">
				{#each [['all', 'All'], ['in', 'Incoming'], ['out', 'Outgoing']] as [v, label] (v)}
					<a
						href={href({ dir: v === 'all' ? undefined : v })}
						aria-current={data.filter.direction === v ? 'true' : undefined}
						class="rounded-md px-2.5 py-1 text-xs font-medium {data.filter.direction === v ? 'bg-surface-2 text-ink' : 'text-ink-muted hover:text-ink'}"
					>{label}</a>
				{/each}
			</div>
			<div class="flex gap-1" role="group" aria-label="Type">
				{#each [['all', 'All types'], ['payment', 'Payments'], ['refund', 'Refunds'], ['payout', 'Payouts']] as [v, label] (v)}
					<a
						href={href({ kind: v === 'all' ? undefined : v })}
						aria-current={data.filter.kind === v ? 'true' : undefined}
						class="rounded-md px-2.5 py-1 text-xs font-medium {data.filter.kind === v ? 'bg-surface-2 text-ink' : 'text-ink-muted hover:text-ink'}"
					>{label}</a>
				{/each}
			</div>
			<form method="GET" action={base} class="flex flex-wrap items-end gap-2">
				{#if data.filter.direction !== 'all'}<input type="hidden" name="dir" value={data.filter.direction} />{/if}
				{#if data.filter.kind !== 'all'}<input type="hidden" name="kind" value={data.filter.kind} />{/if}
				{#if data.filter.recon}<input type="hidden" name="recon" value={data.filter.recon} />{/if}
				<label class="text-xs text-ink-muted">Status
					<select name="status" class="mt-0.5 block h-9 rounded-md border border-input bg-transparent px-2 text-sm text-ink">
						<option value="all">All</option>
						{#each data.statuses as s (s)}<option value={s} selected={data.filter.status === s}>{statusLabel(s)}</option>{/each}
					</select>
				</label>
				<label class="text-xs text-ink-muted">From
					<Input type="date" name="from" value={data.filter.from ?? ''} class="mt-0.5 h-9 w-40" />
				</label>
				<label class="text-xs text-ink-muted">To
					<Input type="date" name="to" value={data.filter.to ?? ''} class="mt-0.5 h-9 w-40" />
				</label>
				<label class="text-xs text-ink-muted">Search
					<Input name="q" value={data.filter.q ?? ''} placeholder="PayMongo ID, guest, reference" class="mt-0.5 h-9 w-60" />
				</label>
				<Button type="submit" size="sm">Apply</Button>
				{#if data.filter.status !== 'all' || data.filter.from || data.filter.to || data.filter.q}
					<a href={href({ status: undefined, from: undefined, to: undefined, q: undefined })} class="pb-2 text-xs text-ink-muted underline underline-offset-2">Reset</a>
				{/if}
			</form>
		</div>

		<!-- Totals for what is filtered -->
		<div class="mb-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
			<div class="rounded-lg border border-border px-3 py-2"><span class="text-xs text-ink-muted">Incoming (gross)</span><p class="font-semibold tabular-nums">{peso(data.totals.inGross)}</p></div>
			<div class="rounded-lg border border-border px-3 py-2"><span class="text-xs text-ink-muted">PayMongo fees</span><p class="font-semibold tabular-nums text-danger">−{peso(data.totals.inFees)}</p></div>
			<div class="rounded-lg border border-border px-3 py-2"><span class="text-xs text-ink-muted">Incoming (net)</span><p class="font-semibold tabular-nums text-ok">{peso(data.totals.inNet)}</p></div>
			<div class="rounded-lg border border-border px-3 py-2"><span class="text-xs text-ink-muted">Refunds out</span><p class="font-semibold tabular-nums text-danger">−{peso(data.totals.refundsOut)}</p></div>
			<div class="rounded-lg border border-border px-3 py-2"><span class="text-xs text-ink-muted">Paid out to bank</span><p class="font-semibold tabular-nums">{peso(data.totals.payoutsOut)}</p></div>
		</div>

		<!-- The records -->
		{#if data.rows.length === 0}
			<p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
				{#if data.syncing || waiting || (!data.balance.lastSyncedAt && !data.balance.lastError)}
					Getting your records from PayMongo… the first sync can take a minute.
				{:else}
					No PayMongo records match this filter.
				{/if}
			</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-border">
				<table class="w-full text-sm">
					<thead class="border-b border-border bg-surface-2 text-left text-xs text-ink-muted">
						<tr>
							<th class="px-3 py-2">Date</th>
							<th class="px-3 py-2">Type</th>
							<th class="px-3 py-2">PayMongo ID</th>
							<th class="px-3 py-2">Details</th>
							<th class="px-3 py-2 text-right">Gross</th>
							<th class="px-3 py-2 text-right">Fee</th>
							<th class="px-3 py-2 text-right">Net</th>
							<th class="px-3 py-2">Status</th>
						</tr>
					</thead>
					<tbody>
						{#each data.rows as r (r.id)}
							<tr class="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2" onclick={() => (detail = r)}>
								<td class="px-3 py-2 whitespace-nowrap text-ink-muted">{when(r.occurredAt)}</td>
								<td class="px-3 py-2 whitespace-nowrap">
									<span class="inline-flex items-center gap-1">
										{#if r.direction === 'in'}<ArrowDownLeftIcon class="size-3.5 text-ok" aria-label="Incoming" />{:else}<ArrowUpRightIcon class="size-3.5 text-danger" aria-label="Outgoing" />{/if}
										{KIND_LABEL[r.kind] ?? r.kind}
									</span>
								</td>
								<td class="px-3 py-2">
									<span class="inline-flex items-center gap-1 font-mono text-xs text-ink-muted">
										{r.paymongoId}
										<button type="button" class="rounded p-0.5 hover:bg-surface hover:text-ink" aria-label="Copy {r.paymongoId}" onclick={(e) => { e.stopPropagation(); copy(r.paymongoId); }}>
											<CopyIcon class="size-3" aria-hidden="true" />
										</button>
									</span>
								</td>
								<td class="px-3 py-2">
									{#if r.kind === 'payout'}
										<span class="text-xs">{r.bankName ?? 'Bank'}{r.accountLast4 ? ` ••••${r.accountLast4}` : ''}</span>
									{:else}
										{#if r.sourceType}<span class="mr-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] uppercase">{r.sourceType}</span>{/if}
										{#if r.guestName}<span class="text-xs">{r.guestName}</span>{/if}
										{#if r.orderId}<a href="/{page.params.hotel}/management/transactions/{r.orderId}" class="ml-1 text-xs text-brand underline underline-offset-2" onclick={(e) => e.stopPropagation()}>booking</a>{/if}
										{#if r.diningCode}<span class="ml-1 font-mono text-xs text-ink-muted">{r.diningCode}</span>{/if}
										{#if r.kind === 'payment' && !r.orderId && !r.diningOrderId}<span class="text-xs text-warning">not linked to a booking</span>{/if}
									{/if}
								</td>
								<td class="px-3 py-2 text-right font-mono">{peso(r.grossCentavos)}</td>
								<td class="px-3 py-2 text-right font-mono text-ink-muted">{r.feeCentavos ? `−${peso(r.feeCentavos)}` : '—'}</td>
								<td class="px-3 py-2 text-right font-mono font-medium {signed(r) >= 0 ? 'text-ok' : 'text-danger'}">{signed(r) < 0 ? '−' : '+'}{peso(signed(r))}</td>
								<td class="px-3 py-2"><Badge variant="outline" class={statusClass(r.status)}>{statusLabel(r.status)}</Badge></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if data.truncated}
				<p class="mt-2 text-xs text-ink-muted">Showing the newest {data.rows.length}. Narrow the dates or download the CSV for the rest.</p>
			{/if}
		{/if}
	</div>
{/if}

<Dialog.Root open={!!detail} onOpenChange={(v) => { if (!v) detail = null; }}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-xl">
		{#if detail}
			<Dialog.Header>
				<Dialog.Title>{KIND_LABEL[detail.kind] ?? detail.kind} · {statusLabel(detail.status)}</Dialog.Title>
				<Dialog.Description>
					{detail.direction === 'in' ? 'Money in' : 'Money out'} · {peso(detail.grossCentavos)}{detail.guestName ? ` · ${detail.guestName}` : ''}
				</Dialog.Description>
			</Dialog.Header>
			<dl class="space-y-1.5 text-sm">
				{#snippet row(label: string, value: string | null | undefined, mono = true)}
					{#if value}
						<div class="flex justify-between gap-3"><dt class="text-ink-muted">{label}</dt><dd class={mono ? 'font-mono text-xs break-all text-right' : 'text-right'}>{value}</dd></div>
					{/if}
				{/snippet}
				{@render row('PayMongo ID', detail.paymongoId)}
				{@render row('Payment', detail.paymentId)}
				{@render row('Payout', detail.payoutId)}
				{@render row('Balance transaction', detail.balanceTransactionId)}
				{@render row('Reference', detail.reference)}
				{@render row('Method', detail.sourceType, false)}
				{@render row('Happened', when(detail.occurredAt), false)}
				{#if detail.kind === 'payment'}
					{@render row('Available to pay out', when(detail.availableAt), false)}
					{@render row('Scheduled credit', when(detail.creditedAt), false)}
					{@render row('Gross', peso(detail.grossCentavos), false)}
					{@render row('PayMongo fee', `−${peso(detail.feeCentavos)}`, false)}
					{@render row('Net to the hotel', peso(detail.netCentavos), false)}
				{/if}
				{#if detail.kind === 'payout'}
					{@render row('Bank', `${detail.bankName ?? ''}${detail.accountLast4 ? ` ••••${detail.accountLast4}` : ''}`, false)}
					{@render row('Fees', peso(detail.feeCentavos), false)}
					{@render row('Net deposited', peso(detail.netCentavos), false)}
				{/if}
				{@render row('Note', detail.description, false)}
			</dl>
			{#if detail.orderId}
				<a href="/{page.params.hotel}/management/transactions/{detail.orderId}" class="text-sm text-brand underline underline-offset-2">Open the booking</a>
			{/if}
			{#if detail.raw}
				<div>
					<p class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">PayMongo's record</p>
					<pre class="max-h-64 overflow-auto rounded-md border border-border bg-surface-2 p-2.5 text-[11px] text-ink">{JSON.stringify(detail.raw, null, 2)}</pre>
				</div>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
