<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/finance`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

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
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<div class="mb-5 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Finance</h1>
			<p class="text-sm text-ink-muted">Business date {data.today}</p>
		</div>
	</div>

	<!-- Top tiles -->
	<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="rounded-xl border border-border p-4">
			<div class="text-xs text-ink-muted">Cash on hand</div>
			<div class="mt-1 text-lg font-semibold text-ink tabular-nums">{peso(data.totalCashCentavos)}</div>
		</div>
		<div class="rounded-xl border border-border p-4">
			<div class="text-xs text-ink-muted">Cash in today</div>
			<div class="mt-1 text-lg font-semibold text-ok tabular-nums">{peso(data.snapshot.cashInCentavos)}</div>
		</div>
		<div class="rounded-xl border border-border p-4">
			<div class="text-xs text-ink-muted">Cash out today</div>
			<div class="mt-1 text-lg font-semibold text-danger tabular-nums">{peso(data.snapshot.cashOutCentavos)}</div>
		</div>
		<div class="rounded-xl border border-border p-4">
			<div class="text-xs text-ink-muted">Revenue MTD</div>
			<div class="mt-1 text-lg font-semibold text-ink tabular-nums">{peso(data.mtdRevenue.totalCentavos)}</div>
		</div>
	</div>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Cash accounts -->
		<section class="rounded-xl border border-border">
			<div class="flex items-center justify-between border-b border-border px-4 py-3">
				<h2 class="text-sm font-semibold text-ink">Cash accounts</h2>
				<a href="{base}/cash" class="text-xs text-ink-muted underline underline-offset-2">Open ledger →</a>
			</div>
			<div class="divide-y divide-border">
				{#each data.position as a (a.accountId)}
					<div class="flex items-center justify-between px-4 py-2.5 text-sm">
						<div>
							<span class="text-ink">{a.name}</span>
							<Badge variant="outline" class="ml-1.5 border-border bg-surface-2 text-ink-muted">{kindLabel[a.kind] ?? a.kind}</Badge>
						</div>
						<span class="font-medium text-ink tabular-nums">{peso(a.closingCentavos)}</span>
					</div>
				{:else}
					<p class="px-4 py-3 text-sm text-ink-muted">
						No cash accounts yet — <a href="{base}/settings" class="underline underline-offset-2">set them up</a>.
					</p>
				{/each}
			</div>
		</section>

		<!-- Revenue MTD by source -->
		<section class="rounded-xl border border-border">
			<div class="border-b border-border px-4 py-3">
				<h2 class="text-sm font-semibold text-ink">Revenue this month by source</h2>
			</div>
			<div class="divide-y divide-border">
				{#each data.mtdRevenue.rows as r (r.source)}
					<div class="flex items-center justify-between px-4 py-2.5 text-sm">
						<span class="text-ink-muted">{sourceLabel[r.source] ?? r.source}</span>
						<span class="text-ink tabular-nums">{peso(r.amountCentavos)}</span>
					</div>
				{:else}
					<p class="px-4 py-3 text-sm text-ink-muted">No revenue recorded yet this month.</p>
				{/each}
			</div>
		</section>

		<!-- Needs attention -->
		<section class="rounded-xl border border-border">
			<div class="border-b border-border px-4 py-3"><h2 class="text-sm font-semibold text-ink">Needs attention</h2></div>
			<div class="divide-y divide-border text-sm">
				<a href="{base}/expenses?status=draft" class="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2">
					<span class="text-ink-muted">Draft expenses awaiting approval</span>
					<span class="text-ink">{data.draftExpenseCount} · {peso(data.draftExpenseTotalCentavos)}</span>
				</a>
				<a href="{base}/receivables" class="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2">
					<span class="text-ink-muted">City-ledger balances outstanding</span>
					<span class="text-ink">{data.arCount} · {peso(data.arOutstandingCentavos)}</span>
				</a>
				<a href="{base}/shifts" class="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2">
					<span class="text-ink-muted">Open cashier shifts</span>
					<span class="text-ink">{data.openShifts.length}</span>
				</a>
			</div>
		</section>

		<!-- Day close -->
		<section class="rounded-xl border border-border">
			<div class="border-b border-border px-4 py-3"><h2 class="text-sm font-semibold text-ink">Day close · {data.today}</h2></div>
			<div class="px-4 py-3 text-sm">
				{#if data.dayClose.closed}
					<p class="mb-2 text-ink">
						<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">Closed</Badge>
						Net cash {peso(data.snapshot.netCentavos)}.
					</p>
					{#if data.finance.canAdmin}
						<form method="POST" action="?/dayReopen" use:enhance>
							<input type="hidden" name="businessDate" value={data.today} />
							<Button type="submit" size="sm" variant="outline">Reopen day</Button>
						</form>
					{/if}
				{:else}
					<p class="mb-2 text-ink-muted">
						Open. Net cash so far {peso(data.snapshot.netCentavos)}
						{#if data.openShifts.length > 0}· {data.openShifts.length} shift(s) still open{/if}.
					</p>
					{#if data.finance.canDayClose}
						<form method="POST" action="?/dayClose" use:enhance>
							<input type="hidden" name="businessDate" value={data.today} />
							<Button type="submit" size="sm" disabled={data.openShifts.length > 0}>Run day close</Button>
						</form>
					{/if}
				{/if}
			</div>
		</section>
	</div>
</div>
