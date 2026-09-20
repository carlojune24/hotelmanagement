<script lang="ts">
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
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
	const qs = (params: Record<string, string>) => {
		const p = new URLSearchParams(params);
		if (data.q) p.set('q', data.q);
		return `?${p.toString()}`;
	};

	let customFrom = $state(data.range.from);
	let customTo = $state(data.range.to);

	const statusLabel: Record<string, string> = {
		confirmed: 'Confirmed',
		in_house: 'In house',
		checked_out: 'Checked out',
		cancelled: 'Cancelled'
	};
	function statusClass(s: string): string {
		if (s === 'cancelled') return 'border-transparent bg-danger/15 text-danger';
		if (s === 'checked_out') return 'border-border bg-surface-2 text-ink-muted';
		return 'border-transparent bg-ok/15 text-ok';
	}
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
	</div>

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
					No bookings with a room or event in this range{data.q ? ' match your search' : ''}.
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
