<script lang="ts">
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import { CHANNEL_LABEL, PAYMENT_FILTERS, SOURCE_FILTERS, type BookingPaymentState } from '$lib/booking-payment-status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/${page.params.hotel}/management`);
	const peso = (c: number) =>
		`₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const PRESETS = [
		{ key: 'today', label: 'Today' },
		{ key: 'week', label: 'This week' },
		{ key: 'month', label: 'This month' }
	] as const;
	// Presets and filter chips each change one thing and keep the rest (search and the other filters).
	const keepFilters = (p: URLSearchParams) => {
		if (data.q) p.set('q', data.q);
		if (data.filters.source !== 'all') p.set('source', data.filters.source);
		if (data.filters.pay !== 'all') p.set('pay', data.filters.pay);
		if (data.filters.scpwd) p.set('scpwd', '1');
	};
	const qs = (params: Record<string, string>) => {
		const p = new URLSearchParams(params);
		keepFilters(p);
		return `?${p.toString()}`;
	};
	/** The current view's query with one filter changed (an empty value removes it). */
	const withFilter = (key: 'source' | 'pay' | 'scpwd', value: string) => {
		const p = new URLSearchParams({ range: data.range.preset, from: data.range.from, to: data.range.to });
		keepFilters(p);
		p.delete(key);
		if (value) p.set(key, value);
		return `?${p.toString()}`;
	};
	const clearFiltersHref = $derived.by(() => {
		const p = new URLSearchParams({ range: data.range.preset, from: data.range.from, to: data.range.to });
		if (data.q) p.set('q', data.q);
		return `?${p.toString()}`;
	});

	// The register print and CSV take exactly what this page is showing: same range, same search.
	const exportQuery = $derived.by(() => {
		const p = new URLSearchParams({ range: data.range.preset, from: data.range.from, to: data.range.to });
		keepFilters(p);
		return p.toString();
	});
	const printHref = $derived(`/${page.params.hotel}/print/transactions?${exportQuery}`);
	const csvHref = $derived(`${base}/transactions/csv?${exportQuery}`);

	let customFrom = $state(data.range.from);
	let customTo = $state(data.range.to);

	const statusLabel: Record<string, string> = {
		confirmed: 'Confirmed',
		in_house: 'In house',
		checked_out: 'Checked out',
		closed: 'Closed',
		cancelled: 'Cancelled'
	};
	function statusClass(s: string): string {
		if (s === 'cancelled') return 'border-transparent bg-danger/15 text-danger';
		if (s === 'checked_out' || s === 'closed') return 'border-border bg-surface-2 text-ink-muted';
		return 'border-transparent bg-ok/15 text-ok';
	}
	const PAY_CLASS: Record<BookingPaymentState, string> = {
		paid: 'border-transparent bg-ok/15 text-ok',
		downpayment: 'border-transparent bg-warning/15 text-warning',
		balance: 'border-transparent bg-danger/15 text-danger',
		credit: 'border-transparent bg-warning/15 text-warning',
		unpaid: 'border-border bg-surface-2 text-ink-muted'
	};
	const filtering = $derived(data.filters.source !== 'all' || data.filters.pay !== 'all' || data.filters.scpwd);
	const rangeLabel = $derived(
		data.range.from === data.range.to ? data.range.from : `${data.range.from} → ${data.range.to}`
	);
</script>

<div class="mx-auto max-w-6xl space-y-5 p-6">
	<div>
		<h1 class="text-xl font-semibold tracking-tight text-ink">Booking transactions</h1>
		<p class="mt-0.5 text-sm text-ink-muted">
			Every booking with a room or event in the range, whatever its age — open one to see its
			payments, deposits and city ledger.
		</p>
	</div>

	<div class="flex flex-wrap items-end gap-x-6 gap-y-3">
		<div class="flex flex-wrap items-center gap-1.5">
			{#each PRESETS as p (p.key)}
				<Button
					size="sm"
					variant={data.range.preset === p.key ? 'default' : 'outline'}
					href={qs({ range: p.key })}>{p.label}</Button
				>
			{/each}
		</div>

		<form method="GET" class="flex flex-wrap items-end gap-2">
			<input type="hidden" name="range" value="custom" />
			{#if data.q}<input type="hidden" name="q" value={data.q} />{/if}
			{#if data.filters.source !== 'all'}<input type="hidden" name="source" value={data.filters.source} />{/if}
			{#if data.filters.pay !== 'all'}<input type="hidden" name="pay" value={data.filters.pay} />{/if}
			{#if data.filters.scpwd}<input type="hidden" name="scpwd" value="1" />{/if}
			<div>
				<label class="text-xs text-ink-muted" for="bt-from">From</label>
				<Input id="bt-from" name="from" type="date" bind:value={customFrom} class="h-8 w-40" />
			</div>
			<div>
				<label class="text-xs text-ink-muted" for="bt-to">To</label>
				<Input id="bt-to" name="to" type="date" bind:value={customTo} class="h-8 w-40" />
			</div>
			<Button
				type="submit"
				size="sm"
				variant={data.range.preset === 'custom' ? 'default' : 'outline'}>Apply range</Button
			>
		</form>

		<form method="GET" class="ml-auto flex items-end gap-2">
			<input type="hidden" name="range" value={data.range.preset} />
			{#if data.filters.source !== 'all'}<input type="hidden" name="source" value={data.filters.source} />{/if}
			{#if data.filters.pay !== 'all'}<input type="hidden" name="pay" value={data.filters.pay} />{/if}
			{#if data.filters.scpwd}<input type="hidden" name="scpwd" value="1" />{/if}
			{#if data.range.preset === 'custom'}
				<input type="hidden" name="from" value={data.range.from} />
				<input type="hidden" name="to" value={data.range.to} />
			{/if}
			<Input
				name="q"
				value={data.q}
				placeholder="Guest, email or booking code"
				class="h-8 w-64"
			/>
			<Button type="submit" size="sm" variant="outline">Search</Button>
		</form>

		<div class="flex items-center gap-1.5">
			<Button size="sm" variant="outline" href={printHref} target="_blank" rel="noopener">
				<PrinterIcon class="size-4" aria-hidden="true" /> Print
			</Button>
			<Button size="sm" variant="outline" href={csvHref} download>
				<DownloadIcon class="size-4" aria-hidden="true" /> CSV
			</Button>
		</div>
	</div>

	<!-- Filters: how it was booked, how far it is paid, and SC/PWD -->
	<div class="flex flex-wrap items-center gap-x-5 gap-y-2" role="group" aria-label="Filters">
		<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Booked">
			{#each SOURCE_FILTERS as f (f.key)}
				<Button size="sm" variant={data.filters.source === f.key ? 'default' : 'outline'} href={withFilter('source', f.key === 'all' ? '' : f.key)}>{f.label}</Button>
			{/each}
		</div>
		<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Payment">
			{#each PAYMENT_FILTERS as f (f.key)}
				<Button size="sm" variant={data.filters.pay === f.key ? 'default' : 'outline'} href={withFilter('pay', f.key === 'all' ? '' : f.key)}>{f.label}</Button>
			{/each}
		</div>
		<Button size="sm" variant={data.filters.scpwd ? 'default' : 'outline'} href={withFilter('scpwd', data.filters.scpwd ? '' : '1')} title="Bookings with a Senior Citizen or PWD discount">SC/PWD only</Button>
		{#if filtering}
			<a href={clearFiltersHref} class="text-xs text-ink-muted underline underline-offset-2">Clear filters</a>
		{/if}
	</div>

	<details class="rounded-xl border border-border bg-surface-2/50 text-sm">
		<summary class="cursor-pointer px-4 py-2.5 font-medium text-ink">How to read this list</summary>
		<div class="space-y-2 border-t border-border px-4 py-3 text-ink-muted">
			<p><strong class="text-ink">Walk-in or Online.</strong> Online means the guest booked on the website and paid through PayMongo. Walk-in means it was made at the front desk or by staff, including phone bookings.</p>
			<p><strong class="text-ink">Downpayment.</strong> The hotel asks for part of the stay online; the percentage shown is what was actually paid out of the booking total. The rest is collected at the desk, so it shows as <em>Owed</em> until then.</p>
			<p><strong class="text-ink">SC/PWD.</strong> A Senior Citizen or PWD discount takes the 12% VAT off the room price, then 20% off what is left. Example: a ₱2,126.88 room becomes ₱1,519.20. The sale is VAT-exempt and the reduction is one line on the guest's folio.</p>
			<p><strong class="text-ink">Credit owed.</strong> The guest has paid more than they now owe. This happens when the SC/PWD discount is applied <em>after</em> they paid the full price: open the booking and use <em>Refund credit</em> to give the difference back.</p>
		</div>
	</details>

	<div class="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-4">
		<div>
			<div class="text-xs text-ink-muted">Bookings · {rangeLabel}</div>
			<div class="text-lg font-semibold tabular-nums text-ink">{data.totals.count}</div>
		</div>
		<div>
			<div class="text-xs text-ink-muted">Charges</div>
			<div class="text-lg font-semibold tabular-nums text-ink">{peso(data.totals.chargesCentavos)}</div>
		</div>
		<div>
			<div class="text-xs text-ink-muted">Paid</div>
			<div class="text-lg font-semibold tabular-nums text-ink">{peso(data.totals.paidCentavos)}</div>
		</div>
		<div>
			<div class="text-xs text-ink-muted">Still owed</div>
			<div
				class="text-lg font-semibold tabular-nums {data.totals.balanceCentavos > 0
					? 'text-danger'
					: 'text-ink'}"
			>
				{peso(data.totals.balanceCentavos)}
			</div>
		</div>
	</div>

	<div class="overflow-hidden rounded-xl border border-border">
		{#if data.rows.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<ReceiptIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">
					No bookings with a room or event in this range{data.q || filtering ? ' match your search or filters' : ''}.
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Booking</Table.Head>
						<Table.Head>Guest</Table.Head>
						<Table.Head>Rooms</Table.Head>
						<Table.Head>Stay</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head title="Online = booked on the website and paid with PayMongo. Walk-in = made at the desk or by staff.">Booked</Table.Head>
						<Table.Head title="Paid in full, a downpayment (the rest is collected at the desk), a balance, or a credit owed back to the guest.">Payment</Table.Head>
						<Table.Head class="text-right">Total</Table.Head>
						<Table.Head class="text-right">Paid</Table.Head>
						<Table.Head class="text-right">Owed</Table.Head>
						<Table.Head></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.rows as r (r.orderId)}
						<Table.Row>
							<Table.Cell>
								<a
									href="{base}/transactions/{r.orderId}?back={encodeURIComponent(page.url.search)}"
									class="font-mono text-sm text-ink underline underline-offset-2 hover:no-underline"
									>{r.code}</a
								>
							</Table.Cell>
							<Table.Cell class="text-ink">
								{r.guestName}
								<span class="block text-xs text-ink-muted">{r.guestEmail}</span>
							</Table.Cell>
							<Table.Cell class="text-ink-muted">{r.roomLabel}</Table.Cell>
							<Table.Cell class="whitespace-nowrap text-ink-muted">
								{r.checkIn}{r.checkOut !== r.checkIn ? ` → ${r.checkOut}` : ''}
							</Table.Cell>
							<Table.Cell>
								<Badge variant="outline" class={statusClass(r.status)}>{statusLabel[r.status]}</Badge>
								{#if r.cancelledCount > 0 && r.status !== 'cancelled'}
									<span class="mt-1 block text-xs text-danger">{r.cancelledCount} of {r.lineCount} cancelled</span>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<Badge variant="outline" class={r.channel === 'online' ? 'border-transparent bg-accent text-ink' : 'border-border bg-surface-2 text-ink-muted'}>{CHANNEL_LABEL[r.channel]}</Badge>
							</Table.Cell>
							<Table.Cell>
								<Badge variant="outline" class={PAY_CLASS[r.paymentState]}>{r.paymentLabel}</Badge>
								{#if r.scPwdLabel}
									<span class="mt-1 block"><Badge variant="outline" class="border-transparent bg-accent text-ink" title="VAT removed and 20% discount applied">SC/PWD · {r.scPwdLabel}</Badge></span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums text-ink">{peso(r.chargesCentavos)}</Table.Cell>
							<Table.Cell class="text-right tabular-nums text-ink-muted">{peso(r.paidCentavos)}</Table.Cell>
							<Table.Cell
								class="text-right tabular-nums font-medium {r.balanceCentavos > 0
									? 'text-danger'
									: 'text-ink-muted'}"
							>
								{r.balanceCentavos > 0 ? peso(r.balanceCentavos) : r.balanceCentavos < 0 ? `credit ${peso(r.balanceCentavos)}` : '—'}
							</Table.Cell>
							<Table.Cell class="text-right">
								<a
									href="/{page.params.hotel}/print/transaction/{r.orderId}"
									target="_blank"
									class="text-xs text-ink-muted underline underline-offset-2 hover:text-ink">Print</a
								>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>
