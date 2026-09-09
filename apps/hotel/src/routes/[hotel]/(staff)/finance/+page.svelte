<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import NetCashChart from '$lib/components/finance/net-cash-chart.svelte';
	import { RANGE_PRESETS, matchPreset, resolveRange } from '$lib/finance-range';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/finance`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const signed = (c: number) =>
		`${c > 0 ? '+' : c < 0 ? '−' : ''}₱${(Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const humanize = (s: string) =>
		s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	const kindLabel: Record<string, string> = {
		cash_drawer: 'Drawer',
		petty_cash: 'Petty cash',
		bank: 'Bank',
		e_wallet: 'E-wallet',
		undeposited: 'Undeposited'
	};
	const sourceLabel: Record<string, string> = {
		room_revenue: 'Rooms',
		hall_revenue: 'Function halls',
		incidental_sale: 'Incidentals',
		other_revenue: 'Other',
		deposit: 'Deposits'
	};
	const methodLabel: Record<string, string> = {
		cash: 'Cash',
		card: 'Card',
		gcash: 'GCash',
		maya: 'Maya',
		bank_transfer: 'Bank transfer',
		cheque: 'Cheque',
		paymongo: 'PayMongo (online)',
		house_use: 'House use'
	};

	// --- date range control ---
	const activePreset = $derived(matchPreset(data.range.from, data.range.to, data.today));
	let showCustom = $state(false);
	let customFrom = $state(data.range.from);
	let customTo = $state(data.range.to);
	$effect(() => {
		customFrom = data.range.from;
		customTo = data.range.to;
	});

	function applyRange(from: string, to: string) {
		const u = new URL(page.url);
		u.searchParams.set('from', from);
		u.searchParams.set('to', to);
		goto(`?${u.searchParams}`, { keepFocus: true, noScroll: true });
	}
	const pickPreset = (key: (typeof RANGE_PRESETS)[number]['key']) => {
		showCustom = false;
		const r = resolveRange(key, data.today);
		applyRange(r.from, r.to);
	};

	const netCash = $derived(data.cashInCentavos - data.cashOutCentavos);
	const cashOutRows = $derived(data.cashflowRows.filter((r) => r.direction === 'out'));
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Finance</h1>
			<p class="text-sm text-ink-muted">Business date {data.today}</p>
		</div>

		<!-- Date range -->
		<div class="flex flex-col items-end gap-1.5">
			<div class="flex flex-wrap gap-1">
				{#each RANGE_PRESETS as p (p.key)}
					<Button
						size="sm"
						variant={activePreset === p.key ? 'default' : 'outline'}
						onclick={() => pickPreset(p.key)}
					>
						{p.label}
					</Button>
				{/each}
				<Button
					size="sm"
					variant={activePreset === 'custom' || showCustom ? 'default' : 'outline'}
					onclick={() => (showCustom = !showCustom)}
				>
					Custom
				</Button>
			</div>
			{#if showCustom}
				<div class="flex items-center gap-1.5 text-sm">
					<input
						type="date"
						bind:value={customFrom}
						max={data.today}
						class="rounded-md border border-input bg-transparent px-2 py-1"
					/>
					<span class="text-ink-muted">→</span>
					<input
						type="date"
						bind:value={customTo}
						max={data.today}
						class="rounded-md border border-input bg-transparent px-2 py-1"
					/>
					<Button size="sm" onclick={() => applyRange(customFrom, customTo)}>Apply</Button>
				</div>
			{/if}
		</div>
	</div>

	<!-- ══ Balances — as of now ══ -->
	<h2 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
		Balances · as of now
	</h2>
	<div class="mb-8 grid gap-4 lg:grid-cols-[1.6fr_1fr] lg:items-start">
		<section class="rounded-xl border border-border">
			<div class="flex items-center justify-between border-b border-border px-4 py-3">
				<div>
					<div class="text-xs text-ink-muted">Cash on hand</div>
					<div class="mt-0.5 text-2xl font-semibold text-ink tabular-nums">
						{peso(data.totalCashCentavos)}
					</div>
					<div class="mt-0.5 text-xs text-ink-muted">
						Total across every account right now — money you hold, not income.
					</div>
				</div>
				<a href="{base}/cash" class="shrink-0 text-xs text-ink-muted underline underline-offset-2">
					Open ledger →
				</a>
			</div>
			<div class="divide-y divide-border">
				{#each data.position as a (a.accountId)}
					<div class="flex items-center justify-between px-4 py-2.5 text-sm">
						<div>
							<span class="text-ink">{a.name}</span>
							<Badge variant="outline" class="ml-1.5 border-border bg-surface-2 text-ink-muted">
								{kindLabel[a.kind] ?? a.kind}
							</Badge>
						</div>
						<span class="font-medium text-ink tabular-nums">{peso(a.closingCentavos)}</span>
					</div>
				{:else}
					<p class="px-4 py-3 text-sm text-ink-muted">
						No cash accounts yet —
						<a href="{base}/settings" class="underline underline-offset-2">set them up</a>.
					</p>
				{/each}
			</div>
		</section>

		<div class="flex flex-col gap-4">
			<section class="rounded-xl border border-border p-4">
				<div class="text-xs text-ink-muted">Owed to you</div>
				<div class="mt-0.5 text-2xl font-semibold text-ink tabular-nums">
					{peso(data.arOutstandingCentavos)}
				</div>
				<div class="mt-0.5 text-xs text-ink-muted">
					Unpaid city-ledger balances across {data.arCount} account{data.arCount === 1 ? '' : 's'}.
				</div>
				<a
					href="{base}/receivables"
					class="mt-3 inline-block text-xs text-ink-muted underline underline-offset-2"
				>
					Open receivables →
				</a>
			</section>

			<section class="rounded-xl border border-brand/40 bg-brand/[0.04]">
				<div class="border-b border-brand/25 px-4 py-3">
					<h2 class="text-sm font-semibold text-ink">Day close · {data.today}</h2>
				</div>
				<div class="px-4 py-3 text-sm">
					{#if data.dayClose.closed}
						<p class="mb-2 text-ink">
							<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">Closed</Badge>
							Net cash {peso(data.todayNetCentavos)}.
						</p>
						{#if data.finance.canAdmin}
							<form method="POST" action="?/dayReopen" use:enhance>
								<input type="hidden" name="businessDate" value={data.today} />
								<Button type="submit" size="sm" variant="outline">Reopen day</Button>
							</form>
						{/if}
					{:else}
						<p class="mb-2 text-ink-muted">
							Open. Net cash so far {peso(data.todayNetCentavos)}
							{#if data.openShifts.length > 0}· {data.openShifts.length} shift(s) still open{/if}.
						</p>
						{#if data.finance.canDayClose}
							<form method="POST" action="?/dayClose" use:enhance>
								<input type="hidden" name="businessDate" value={data.today} />
								<Button type="submit" size="sm" disabled={data.openShifts.length > 0}>
									Run day close
								</Button>
							</form>
						{:else}
							<p class="text-xs text-ink-muted">You don't have permission to close the day.</p>
						{/if}
					{/if}
				</div>
			</section>
		</div>
	</div>

	<!-- ══ Activity — selected range ══ -->
	<h2 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
		Activity · {data.range.label}
	</h2>

	<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
		<div class="rounded-xl border border-border p-4">
			<div class="text-xs text-ink-muted">Cash received</div>
			<div class="mt-1 text-lg font-semibold text-ok tabular-nums">{peso(data.cashInCentavos)}</div>
		</div>
		<div class="rounded-xl border border-border p-4">
			<div class="text-xs text-ink-muted">Cash paid out</div>
			<div class="mt-1 text-lg font-semibold text-danger tabular-nums">
				{peso(data.cashOutCentavos)}
			</div>
		</div>
		<div class="rounded-xl border border-border p-4">
			<div class="text-xs text-ink-muted">Net cash movement</div>
			<div
				class="mt-1 text-lg font-semibold tabular-nums"
				class:text-ok={netCash >= 0}
				class:text-danger={netCash < 0}
			>
				{signed(netCash)}
			</div>
		</div>
		<div class="rounded-xl border border-border p-4">
			<div class="text-xs text-ink-muted">Revenue</div>
			<div class="mt-1 text-lg font-semibold text-ink tabular-nums">
				{peso(data.revenue.totalCentavos)}
			</div>
			<div class="mt-0.5 text-[11px] text-ink-muted">rooms, halls, incidentals</div>
		</div>
		<div class="rounded-xl border border-border p-4">
			<div class="text-xs text-ink-muted">Expenses</div>
			<div class="mt-1 text-lg font-semibold text-ink tabular-nums">
				{peso(data.expenses.totalGrossCentavos)}
			</div>
			<div class="mt-0.5 text-[11px] text-ink-muted">
				{#if data.expenses.uncategorisedPayoutCentavos > 0}
					incl. {peso(data.expenses.uncategorisedPayoutCentavos)} drawer payouts
				{:else}
					recorded expenses + drawer payouts
				{/if}
			</div>
		</div>
	</div>

	<section class="mb-6 rounded-xl border border-border p-4">
		<div class="mb-3 flex items-baseline justify-between">
			<h3 class="text-sm font-semibold text-ink">Daily net cash</h3>
			<span class="text-xs text-ink-muted">cash in − cash out, per day</span>
		</div>
		<NetCashChart days={data.dailySeries} />
	</section>

	<div class="mb-8 grid gap-4 lg:grid-cols-3">
		<section class="rounded-xl border border-border">
			<div class="border-b border-border px-4 py-3">
				<h3 class="text-sm font-semibold text-ink">Revenue by source</h3>
			</div>
			<div class="divide-y divide-border">
				{#each data.revenue.rows as r (r.source)}
					<div class="flex items-center justify-between px-4 py-2.5 text-sm">
						<span class="text-ink-muted">{sourceLabel[r.source] ?? humanize(r.source)}</span>
						<span class="text-ink tabular-nums">{peso(r.amountCentavos)}</span>
					</div>
				{:else}
					<p class="px-4 py-3 text-sm text-ink-muted">No revenue in this range.</p>
				{/each}
			</div>
		</section>

		<section class="rounded-xl border border-border">
			<div class="border-b border-border px-4 py-3">
				<h3 class="text-sm font-semibold text-ink">Where cash went</h3>
			</div>
			<div class="divide-y divide-border">
				{#each cashOutRows as r (r.category)}
					<div class="flex items-center justify-between px-4 py-2.5 text-sm">
						<span class="text-ink-muted">{humanize(r.category)}</span>
						<span class="text-ink tabular-nums">{peso(r.amountCentavos)}</span>
					</div>
				{:else}
					<p class="px-4 py-3 text-sm text-ink-muted">No cash paid out in this range.</p>
				{/each}
			</div>
		</section>

		<section class="rounded-xl border border-border">
			<div class="border-b border-border px-4 py-3">
				<h3 class="text-sm font-semibold text-ink">Payments taken by method</h3>
			</div>
			<div class="divide-y divide-border">
				{#each data.methodMix.rows as r (r.method)}
					<div class="flex items-center justify-between px-4 py-2.5 text-sm">
						<span class="text-ink-muted">
							{methodLabel[r.method] ?? humanize(r.method)}
							<span class="text-[11px]">· {r.count}</span>
						</span>
						<span class="text-ink tabular-nums">{peso(r.amountCentavos)}</span>
					</div>
				{:else}
					<p class="px-4 py-3 text-sm text-ink-muted">No payments in this range.</p>
				{/each}
			</div>
		</section>
	</div>

	<!-- ══ Needs attention ══ -->
	<div>
		<section class="rounded-xl border border-border">
			<div class="border-b border-border px-4 py-3">
				<h2 class="text-sm font-semibold text-ink">Needs attention</h2>
			</div>
			<div class="divide-y divide-border text-sm">
				<a
					href="{base}/expenses?status=draft"
					class="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2"
				>
					<span class="text-ink-muted">Draft expenses awaiting approval</span>
					<span class="text-ink">{data.draftExpenseCount} · {peso(data.draftExpenseTotalCentavos)}</span>
				</a>
				<a
					href="{base}/receivables"
					class="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2"
				>
					<span class="text-ink-muted">City-ledger balances outstanding</span>
					<span class="text-ink">{data.arCount} · {peso(data.arOutstandingCentavos)}</span>
				</a>
				<a
					href="{base}/shifts"
					class="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2"
				>
					<span class="text-ink-muted">Open cashier shifts</span>
					<span class="text-ink">{data.openShifts.length}</span>
				</a>
			</div>
		</section>
	</div>
</div>
