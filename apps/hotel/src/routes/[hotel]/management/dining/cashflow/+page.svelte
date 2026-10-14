<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management/dining`);
	const peso = (c: number) =>
		`${c < 0 ? '−' : ''}₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	let from = $state('');
	let to = $state('');
	$effect(() => {
		from = data.from;
		to = data.to;
	});

	let payoutOpen = $state(false);
	$effect(() => {
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			payoutOpen = false;
		}
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	const r = $derived(data.report);
	// A zero reads as a dash so the columns scan; real amounts keep the peso format.
	const money = (c: number) => (c ? peso(c) : '—');
	const movementTotals = $derived({
		in: r.movements.filter((m) => m.direction === 'in').reduce((s, m) => s + m.amountCentavos, 0),
		out: r.movements.filter((m) => m.direction === 'out').reduce((s, m) => s + m.amountCentavos, 0)
	});
	const awaiting = $derived(Math.max(0, r.awaitingPayout.centavos));
	const isEmpty = $derived(r.byDay.length === 0 && r.movements.length === 0);

	const METHOD: Record<string, string> = {
		cash: 'Cash',
		card: 'Card',
		gcash: 'GCash',
		maya: 'Maya',
		paymongo: 'Online (PayMongo)',
		room_folio: 'Room bill settled',
		bank_transfer: 'Bank transfer',
		cheque: 'Cheque',
		unknown: 'Unknown'
	};
	const KIND: Record<string, string> = { cash_drawer: 'Drawer', petty_cash: 'Petty cash', bank: 'Bank', e_wallet: 'E-wallet', undeposited: 'Undeposited' };

	const query = (range: { from: string; to: string }) => new URLSearchParams({ from: range.from, to: range.to }).toString();
	const isActive = (range: { from: string; to: string }) => range.from === data.from && range.to === data.to;
	const PRESETS = [
		{ key: 'today', label: 'Today' },
		{ key: 'week', label: 'Last 7 days' },
		{ key: 'month', label: 'This month' }
	] as const;

	const fmtDay = (d: string) =>
		new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
	const fmtTime = (d: Date | string) =>
		new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(d));
</script>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-5 flex flex-wrap items-end gap-3">
		<div class="flex gap-1.5" role="group" aria-label="Date range">
			{#each PRESETS as p (p.key)}
				<Button href="?{query(data.presets[p.key])}" variant={isActive(data.presets[p.key]) ? 'default' : 'outline'} size="sm">{p.label}</Button>
			{/each}
		</div>
		<form
			method="GET"
			class="flex items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				goto(`?${query({ from, to })}`, { keepFocus: true, noScroll: true });
			}}
		>
			<div>
				<Label for="cfFrom" class="text-xs">From</Label>
				<Input id="cfFrom" type="date" bind:value={from} max={data.today} class="mt-1 h-8 w-36" />
			</div>
			<div>
				<Label for="cfTo" class="text-xs">To</Label>
				<Input id="cfTo" type="date" bind:value={to} max={data.today} class="mt-1 h-8 w-36" />
			</div>
			<Button type="submit" variant="outline" size="sm" class="h-8">Apply</Button>
		</form>
		<div class="ml-auto flex items-center gap-2">
			<Button href="/{page.params.hotel}/print/dining-cashflow?{query({ from: data.from, to: data.to })}" target="_blank" rel="noopener" variant="outline" size="sm">
				<PrinterIcon class="size-4" /> Print
			</Button>
			<Button href="{base}/cashflow/csv?{query({ from: data.from, to: data.to })}" variant="outline" size="sm" download>
				<DownloadIcon class="size-4" /> CSV
			</Button>
		</div>
	</div>

	<dl class="grid grid-cols-2 divide-border overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-4 sm:divide-x">
		<div class="px-4 py-3">
			<dt class="text-xs text-ink-muted">Money in</dt>
			<dd class="text-xl font-semibold tabular-nums text-ink">{peso(r.totals.inCentavos)}</dd>
		</div>
		<div class="px-4 py-3">
			<dt class="text-xs text-ink-muted">Refunds out</dt>
			<dd class="text-xl font-semibold tabular-nums text-ink">{peso(r.totals.refundCentavos)}</dd>
		</div>
		<div class="px-4 py-3">
			<dt class="text-xs text-ink-muted">Net</dt>
			<dd class="text-xl font-semibold tabular-nums text-ink">{peso(r.totals.netCentavos)}</dd>
		</div>
		<div class="px-4 py-3">
			<dt class="text-xs text-ink-muted">Online money awaiting payout</dt>
			<dd class="text-xl font-semibold tabular-nums text-ink">{peso(awaiting)}</dd>
		</div>
	</dl>

	<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-muted">
		<p class="max-w-3xl">
			Online (PayMongo) payments wait in <strong class="font-medium text-ink">Undeposited Funds</strong> until PayMongo pays out to the bank. This figure is all time, not just the dates above.
			Dining income is booked to account 4040 (Food &amp; Beverage Revenue).
		</p>
		{#if data.canSettle && awaiting > 0}
			<Button size="sm" variant="outline" class="print:hidden" onclick={() => (payoutOpen = !payoutOpen)}>
				<WalletIcon class="size-4" /> Record PayMongo payout
			</Button>
		{/if}
	</div>

	{#if payoutOpen && data.canSettle}
		<form method="POST" action="?/recordPayout" use:enhance class="mt-3 grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-4 print:hidden">
			<div>
				<Label for="payTo" class="text-xs">Paid into</Label>
				<select id="payTo" name="toAccountId" required class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.payoutTargets as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
				</select>
			</div>
			<div>
				<Label for="payAmt" class="text-xs">Amount (₱)</Label>
				<Input id="payAmt" name="amount" type="number" min="0.01" max={(awaiting / 100).toFixed(2)} step="0.01" value={(awaiting / 100).toFixed(2)} required class="mt-1" />
			</div>
			<div class="sm:col-span-2 flex items-end gap-2">
				<Input name="memo" placeholder="Reference / memo (optional)" class="mt-1" />
				<Button type="submit" size="sm" disabled={data.payoutTargets.length === 0}>Record payout</Button>
			</div>
			{#if data.payoutTargets.length === 0}
				<p class="text-xs text-ink-muted sm:col-span-4">There is no bank or e-wallet account yet. Add one in Finance → Settings first.</p>
			{/if}
		</form>
	{/if}

	{#if r.needsAttention.length > 0}
		<section aria-labelledby="attention" class="mt-6 rounded-xl border border-warning/40 bg-warning/5 p-4">
			<h2 id="attention" class="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
				<TriangleAlertIcon class="size-4" /> Paid, but not in Finance ({r.needsAttention.length})
			</h2>
			<p class="mb-2 text-xs text-ink-muted">These orders are marked paid but have no cash movement behind them, so their money is missing from Finance. Void the payment and take it again, or tell your accountant.</p>
			<ul class="divide-y divide-border text-sm">
				{#each r.needsAttention as o (o.orderId)}
					<li class="flex items-center justify-between gap-3 py-1.5">
						<span><span class="font-mono">{o.code}</span> <span class="text-ink-muted">· {o.businessDate ? fmtDay(o.businessDate) : '—'} · {METHOD[o.method ?? 'unknown'] ?? o.method}</span></span>
						<span class="tabular-nums">{peso(o.totalCentavos)}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if isEmpty}
		<div class="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-12 text-center">
			<WalletIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">No dining money moved from {fmtDay(data.from)} to {fmtDay(data.to)}.</p>
			<p class="text-xs text-ink-muted">Cash received and refunds appear here the day they are recorded. Orders charged to a room appear when the guest settles their bill.</p>
		</div>
	{:else}
		<div class="mt-6 space-y-8">
			<section aria-labelledby="cfDay">
				<h2 id="cfDay" class="mb-2 text-sm font-semibold text-ink">By day</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Date</Table.Head>
								<Table.Head class="w-36 text-right">Money in</Table.Head>
								<Table.Head class="w-36 text-right">Refunds out</Table.Head>
								<Table.Head class="w-36 text-right">Net</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.byDay as d (d.date)}
								<Table.Row>
									<Table.Cell class="text-ink">{fmtDay(d.date)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums {d.inCentavos ? 'text-ok' : 'text-ink-muted'}">{money(d.inCentavos)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums {d.refundCentavos ? 'text-danger' : 'text-ink-muted'}">{money(d.refundCentavos)}</Table.Cell>
									<Table.Cell class="text-right font-medium tabular-nums text-ink">{peso(d.inCentavos - d.refundCentavos)}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
						<Table.Footer>
							<Table.Row>
								<Table.Cell class="text-ink">Total</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ok">{peso(r.totals.inCentavos)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-danger">{peso(r.totals.refundCentavos)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{peso(r.totals.netCentavos)}</Table.Cell>
							</Table.Row>
						</Table.Footer>
					</Table.Root>
				</div>
			</section>

			<section aria-labelledby="cfAccount">
				<h2 id="cfAccount" class="mb-2 text-sm font-semibold text-ink">Where the money sits</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Account</Table.Head>
								<Table.Head>Type</Table.Head>
								<Table.Head class="w-36 text-right">Money in</Table.Head>
								<Table.Head class="w-36 text-right">Refunds out</Table.Head>
								<Table.Head class="w-36 text-right">Net</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.byAccount as a (a.accountId)}
								<Table.Row>
									<Table.Cell class="text-ink">{a.name}</Table.Cell>
									<Table.Cell class="text-ink-muted">{KIND[a.kind] ?? a.kind}</Table.Cell>
									<Table.Cell class="text-right tabular-nums {a.inCentavos ? 'text-ok' : 'text-ink-muted'}">{money(a.inCentavos)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums {a.refundCentavos ? 'text-danger' : 'text-ink-muted'}">{money(a.refundCentavos)}</Table.Cell>
									<Table.Cell class="text-right font-medium tabular-nums text-ink">{peso(a.inCentavos - a.refundCentavos)}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
						<Table.Footer>
							<Table.Row>
								<Table.Cell colspan={2} class="text-ink">Total</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ok">{peso(r.totals.inCentavos)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-danger">{peso(r.totals.refundCentavos)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{peso(r.totals.netCentavos)}</Table.Cell>
							</Table.Row>
						</Table.Footer>
					</Table.Root>
				</div>
			</section>

			<section aria-labelledby="cfMethod">
				<h2 id="cfMethod" class="mb-2 text-sm font-semibold text-ink">By payment method</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Method</Table.Head>
								<Table.Head class="w-36 text-right">Money in</Table.Head>
								<Table.Head class="w-36 text-right">Refunds out</Table.Head>
								<Table.Head class="w-36 text-right">Net</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.byMethod as m (m.method)}
								<Table.Row>
									<Table.Cell class="text-ink">{METHOD[m.method] ?? m.method}</Table.Cell>
									<Table.Cell class="text-right tabular-nums {m.inCentavos ? 'text-ok' : 'text-ink-muted'}">{money(m.inCentavos)}</Table.Cell>
									<Table.Cell class="text-right tabular-nums {m.refundCentavos ? 'text-danger' : 'text-ink-muted'}">{money(m.refundCentavos)}</Table.Cell>
									<Table.Cell class="text-right font-medium tabular-nums text-ink">{peso(m.inCentavos - m.refundCentavos)}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
						<Table.Footer>
							<Table.Row>
								<Table.Cell class="text-ink">Total</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ok">{peso(r.totals.inCentavos)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-danger">{peso(r.totals.refundCentavos)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink">{peso(r.totals.netCentavos)}</Table.Cell>
							</Table.Row>
						</Table.Footer>
					</Table.Root>
				</div>
			</section>

			<section aria-labelledby="cfMovements">
				<h2 id="cfMovements" class="mb-2 text-sm font-semibold text-ink">Movements</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>When</Table.Head>
								<Table.Head>Account</Table.Head>
								<Table.Head>Method</Table.Head>
								<Table.Head>Details</Table.Head>
								<Table.Head class="w-36 text-right">In</Table.Head>
								<Table.Head class="w-36 text-right">Out</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.movements as m (m.id)}
								<Table.Row>
									<Table.Cell class="whitespace-nowrap text-ink-muted">{fmtTime(m.occurredAt)}</Table.Cell>
									<Table.Cell class="text-ink">{m.account}</Table.Cell>
									<Table.Cell class="text-ink-muted">{METHOD[m.method] ?? m.method}</Table.Cell>
									<Table.Cell class="max-w-[18rem] truncate text-ink-muted">{m.orderCode ?? m.memo ?? ''}</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-ok">{m.direction === 'in' ? peso(m.amountCentavos) : ''}</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-danger">{m.direction === 'out' ? peso(m.amountCentavos) : ''}</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
						<Table.Footer>
							<Table.Row>
								<Table.Cell colspan={4} class="text-ink">Total{r.movements.length === 100 ? ' (latest 100)' : ''}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ok">{peso(movementTotals.in)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-danger">{peso(movementTotals.out)}</Table.Cell>
							</Table.Row>
						</Table.Footer>
					</Table.Root>
				</div>
				{#if r.movements.length === 100}<p class="mt-1 text-xs text-ink-muted">Showing the latest 100. Download the CSV or narrow the dates for the rest.</p>{/if}
			</section>

			<section aria-labelledby="cfPayouts">
				<h2 id="cfPayouts" class="mb-2 text-sm font-semibold text-ink">PayMongo payouts recorded</h2>
				<div class="overflow-x-auto rounded-xl border border-border">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Date</Table.Head>
								<Table.Head>Paid into</Table.Head>
								<Table.Head>Reference</Table.Head>
								<Table.Head class="w-36 text-right">Amount</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each r.payouts as p (p.id)}
								<Table.Row>
									<Table.Cell class="text-ink-muted">{fmtDay(p.businessDate)}</Table.Cell>
									<Table.Cell class="text-ink">{p.toAccount ?? '—'}</Table.Cell>
									<Table.Cell class="max-w-[18rem] truncate text-ink-muted">{p.memo ?? ''}</Table.Cell>
									<Table.Cell class="text-right tabular-nums text-ink">{peso(p.amountCentavos)}</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row><Table.Cell colspan={4} class="py-6 text-center text-ink-muted">No payouts recorded yet.</Table.Cell></Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			</section>
		</div>
		<p class="mt-4 text-xs text-ink-muted">Cashflow counts money actually received, by the day it was recorded. Sales counts orders. They differ for orders charged to a room (Sales counts them on the charge date, Cashflow when the guest pays their bill) and when part of an order is refunded.</p>
	{/if}
</div>
