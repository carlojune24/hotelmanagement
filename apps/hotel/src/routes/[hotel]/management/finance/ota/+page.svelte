<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const toCentavos = (v: string) => Math.round(Number(v) * 100);
	/** 2026-10-30 -> Oct 30 */
	const day = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

	type Row = PageData['rows'][number];
	/** Ticked receivable ids → the amount typed as received (pesos), prefilled with the expected net. */
	let received = $state<Record<string, string>>({});
	let statementRef = $state('');
	let search = $state('');
	let confirming = $state(false);
	let busy = $state(false);

	/** The OTA whose tab is open (?ota=…), else the first one with bookings waiting, else the first tab. */
	const selected = $derived.by(() => {
		const asked = page.url.searchParams.get('ota');
		if (asked && data.tabs.includes(asked)) return asked;
		return data.tabs.find((t) => data.rows.some((r) => r.ota?.name === t)) ?? data.tabs[0] ?? '';
	});
	const view = $derived(data.view);
	const countOf = (t: string) => data.rows.filter((r) => r.ota?.name === t).length;
	const tabHref = (t: string) => `?ota=${encodeURIComponent(t)}${view === 'paid' ? '&view=paid' : ''}`;
	const viewHref = (v: 'waiting' | 'paid') => `?ota=${encodeURIComponent(selected)}${v === 'paid' ? '&view=paid' : ''}`;
	const expectedOf = (t: string) => data.rows.filter((r) => r.ota?.name === t).reduce((n, r) => n + expected(r), 0);

	// One statement is one OTA's: nothing ticked or typed carries over to another tab.
	$effect(() => {
		void selected;
		received = {};
		statementRef = '';
		search = '';
		confirming = false;
	});
	$effect(() => {
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			received = {};
			statementRef = '';
			confirming = false;
		}
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	const tabRows = $derived(data.rows.filter((r) => r.ota?.name === selected));
	/** This OTA's recorded payouts (one per statement), filtered by the search box. */
	const statements = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return data.paid
			.filter((s) => s.otaName === selected)
			.map((s) => ({
				...s,
				bookings: q
					? s.bookings.filter((b) => [b.guestName, b.reference, b.orderCode, s.statementRef].some((v) => (v ?? '').toLowerCase().includes(q)))
					: s.bookings
			}))
			.filter((s) => s.bookings.length > 0);
	});
	const paidTotals = $derived({
		statements: statements.length,
		received: statements.reduce((n, s) => n + s.bookings.reduce((m, b) => m + b.receivedCentavos, 0), 0),
		commission: statements.reduce((n, s) => n + s.bookings.reduce((m, b) => m + b.commissionCentavos, 0), 0)
	});
	const dateLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
	const shown = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return tabRows;
		return tabRows.filter((r) =>
			[r.ota?.guestName, r.ota?.reference, r.orderCode, r.roomLabel].some((v) => (v ?? '').toLowerCase().includes(q))
		);
	});

	const ticked = (r: Row) => r.id in received;
	/** The net the OTA owes for what is still open (a room cancelled at the OTA already came off the account). */
	const expected = (r: Row) => Math.min(r.ota?.netCentavos ?? 0, r.outstandingCentavos);
	const gotCentavos = (r: Row) => toCentavos(received[r.id] ?? '0');
	/** Why a ticked row can't be submitted, or null. */
	function problem(r: Row): string | null {
		const c = gotCentavos(r);
		if (!Number.isFinite(c) || c <= 0) return 'Enter the amount received.';
		if (c > r.outstandingCentavos) return `Cannot be more than ${peso(r.outstandingCentavos)}.`;
		return null;
	}
	function toggle(r: Row, on: boolean) {
		const next = { ...received };
		if (on) next[r.id] = (expected(r) / 100).toFixed(2);
		else delete next[r.id];
		received = next;
		confirming = false;
	}
	function toggleAll(rows: Row[], on: boolean) {
		const next = { ...received };
		for (const r of rows) {
			if (on) next[r.id] ??= (expected(r) / 100).toFixed(2);
			else delete next[r.id];
		}
		received = next;
		confirming = false;
	}

	const tickedRows = $derived(tabRows.filter(ticked));
	const totalReceived = $derived(tickedRows.reduce((n, r) => n + (gotCentavos(r) || 0), 0));
	const totalCommission = $derived(tickedRows.reduce((n, r) => n + (r.outstandingCentavos - (gotCentavos(r) || 0)), 0));
	const blocked = $derived(
		tickedRows.length === 0 || !statementRef.trim() || tickedRows.some((r) => problem(r) !== null)
	);
	const itemsJson = $derived(
		JSON.stringify(tickedRows.map((r) => ({ receivableId: r.id, netReceivedCentavos: gotCentavos(r) })))
	);
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-6 pb-32 sm:px-6">
	<div class="mb-4">
		<h1 class="text-xl font-semibold tracking-tight text-ink">OTA payouts</h1>
		<p class="text-sm text-ink-muted">Bookings the OTA collected from guests and still owes you, net of its commission. Open the OTA's tab, tick what its statement covers.</p>
	</div>

	{#if data.tabs.length === 0}
		<div class="rounded-xl border border-border p-8 text-center">
			<p class="font-medium text-ink">No OTA is set up yet.</p>
			<p class="mt-1 text-sm text-ink-muted">A hotel admin adds the OTAs in Settings.</p>
		</div>
	{:else}
		<nav class="mb-5 flex gap-1 overflow-x-auto border-b border-border" aria-label="OTAs">
			{#each data.tabs as t (t)}
				<a
					href={tabHref(t)}
					data-sveltekit-noscroll
					aria-current={t === selected ? 'page' : undefined}
					class="-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap {t === selected
						? 'border-ink text-ink'
						: 'border-transparent text-ink-muted hover:text-ink'}"
				>
					{t}
					<span class="ml-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums text-ink-muted">{countOf(t)}</span>
				</a>
			{/each}
		</nav>

		<div class="mb-4 inline-flex gap-1 rounded-lg bg-surface-2 p-1 text-sm" role="group" aria-label="View">
			{#each [['waiting', 'Awaiting payout'], ['paid', 'Paid out']] as [key, label] (key)}
				<a
					href={viewHref(key as 'waiting' | 'paid')}
					data-sveltekit-noscroll
					aria-current={view === key ? 'true' : undefined}
					class="rounded-md px-3 py-1.5 font-medium {view === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}"
				>
					{label}
				</a>
			{/each}
		</div>

		{#if view === 'paid'}
			{#if data.paid.every((s) => s.otaName !== selected)}
				<div class="rounded-xl border border-border p-8 text-center">
					<p class="font-medium text-ink">{selected} hasn't paid out anything yet.</p>
					<p class="mt-1 text-sm text-ink-muted">Payouts you record under Awaiting payout are listed here, one block per statement.</p>
				</div>
			{:else}
				<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
					<div>
						<div class="text-xs text-ink-muted">{selected} has paid you</div>
						<div class="text-lg font-semibold text-ink tabular-nums">{peso(paidTotals.received)}</div>
						<div class="text-xs text-ink-muted tabular-nums">{paidTotals.statements} statement(s) · commission {peso(paidTotals.commission)}</div>
					</div>
					<div class="w-full sm:w-72">
						<Label for="otaSearch" class="text-xs">Find a booking or statement</Label>
						<Input id="otaSearch" type="search" bind:value={search} placeholder="Guest, OTA reference, code or statement" class="mt-1 h-9" />
					</div>
				</div>
				<div class="space-y-4">
					{#each statements as st (st.statementRef + st.date)}
						<section class="overflow-x-auto rounded-xl border border-border">
							<div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
								<h2 class="text-sm font-semibold text-ink">Statement {st.statementRef || 'with no reference'}</h2>
								<div class="text-xs text-ink-muted tabular-nums">
									{dateLabel(st.date)} · received {peso(st.bookings.reduce((n, b) => n + b.receivedCentavos, 0))} · commission {peso(st.bookings.reduce((n, b) => n + b.commissionCentavos, 0))}
								</div>
							</div>
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head>Booking</Table.Head>
										<Table.Head class="text-right">Received</Table.Head>
										<Table.Head class="text-right">Commission</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each st.bookings as b (b.receivableId)}
										<Table.Row>
											<Table.Cell class="text-ink">
												<a href="/{page.params.hotel}/management/transactions/{b.orderId}" class="underline underline-offset-2 hover:text-ink-muted">
													<span class="font-mono text-xs">{b.orderCode}</span> · {b.guestName}
												</a>
												<span class="block text-xs text-ink-muted">Ref {b.reference}</span>
											</Table.Cell>
											<Table.Cell class="text-right tabular-nums font-medium text-ink">{peso(b.receivedCentavos)}</Table.Cell>
											<Table.Cell class="text-right tabular-nums text-ink-muted">{peso(b.commissionCentavos)}</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</section>
					{:else}
						<div class="rounded-xl border border-border p-6 text-center text-sm text-ink-muted">Nothing matches “{search}”.</div>
					{/each}
				</div>
			{/if}
		{:else if tabRows.length === 0}
			<div class="rounded-xl border border-border p-8 text-center">
				<p class="font-medium text-ink">Nothing is waiting for a payout from {selected}.</p>
				<p class="mt-1 text-sm text-ink-muted">
					Add one from Front desk → Walk-in → OTA booking. It shows up here until {selected} pays it out.
				</p>
			</div>
		{:else}
			<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
				<div>
					<div class="text-xs text-ink-muted">{selected} owes you</div>
					<div class="text-lg font-semibold text-ink tabular-nums">{peso(expectedOf(selected))}</div>
					<div class="text-xs text-ink-muted">{tabRows.length} booking(s) awaiting payout</div>
				</div>
				<div class="w-full sm:w-72">
					<Label for="otaSearch" class="text-xs">Find a booking</Label>
					<Input id="otaSearch" type="search" bind:value={search} placeholder="Guest, OTA reference or booking code" class="mt-1 h-9" />
				</div>
			</div>

			<div class="overflow-x-auto rounded-xl border border-border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="w-10">
								<Checkbox checked={shown.length > 0 && shown.every(ticked)} onCheckedChange={(v) => toggleAll(shown, v === true)} aria-label="Select all shown {selected} bookings" />
							</Table.Head>
							<Table.Head>Booking</Table.Head>
							<Table.Head class="text-right">Expected</Table.Head>
							<Table.Head class="text-right">Received</Table.Head>
							<Table.Head>Stay</Table.Head>
							<Table.Head class="text-right">Guest paid</Table.Head>
							<Table.Head class="text-right">Commission</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each shown as r (r.id)}
							{@const short = ticked(r) && !problem(r) ? expected(r) - gotCentavos(r) : 0}
							<Table.Row>
								<Table.Cell>
									<Checkbox checked={ticked(r)} onCheckedChange={(v) => toggle(r, v === true)} aria-label="Select booking {r.orderCode}" />
								</Table.Cell>
								<Table.Cell class="text-ink">
									<a href="/{page.params.hotel}/management/transactions/{r.orderId}" class="underline underline-offset-2 hover:text-ink-muted">
										<span class="font-mono text-xs">{r.orderCode}</span> · {r.ota?.guestName}
									</a>
									<span class="block text-xs text-ink-muted">Ref {r.ota?.reference}{r.roomLabel ? ` · ${r.roomLabel}` : ''}</span>
								</Table.Cell>
								<Table.Cell class="text-right tabular-nums font-medium text-ink">{peso(expected(r))}</Table.Cell>
								<Table.Cell class="min-w-44 text-right">
									{#if ticked(r)}
										<Input
											type="number"
											min="0.01"
											step="0.01"
											inputmode="decimal"
											bind:value={received[r.id]}
											oninput={() => (confirming = false)}
											aria-label="Amount received for booking {r.orderCode}"
											aria-invalid={problem(r) ? 'true' : undefined}
											class="ml-auto h-8 w-32 text-right tabular-nums"
										/>
										{#if problem(r)}
											<span class="mt-1 block text-xs text-danger">{problem(r)}</span>
										{:else if short > 0}
											<span class="mt-1 block text-xs text-warning">Short {peso(short)}, counted as extra commission</span>
										{/if}
									{:else}
										<span class="text-ink-muted">—</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="whitespace-nowrap text-ink-muted">{day(r.ota?.checkIn)} → {day(r.ota?.checkOut)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink-muted">{peso(r.ota?.grossCentavos ?? 0)}</Table.Cell>
								<Table.Cell class="text-right tabular-nums text-ink-muted">{peso(r.ota?.commissionCentavos ?? 0)}</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={7} class="py-6 text-center text-ink-muted">No booking matches “{search}”.</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	{/if}
</div>

{#if view === 'waiting' && tabRows.length > 0 && data.finance.canReceivable}
	<form
		method="POST"
		action="?/record"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
		class="sticky bottom-0 z-10 border-t border-border bg-surface px-4 py-3 sm:px-6"
	>
		<input type="hidden" name="itemsJson" value={itemsJson} />
		<div class="mx-auto flex w-full max-w-5xl flex-wrap items-end gap-3">
			<div class="min-w-52 flex-1">
				<Label for="otaStatementRef" class="text-xs">{selected} statement or payment reference</Label>
				<Input id="otaStatementRef" name="statementRef" bind:value={statementRef} oninput={() => (confirming = false)} maxlength={120} class="mt-1 h-9" />
			</div>
			<div class="text-sm tabular-nums">
				<div class="text-ink-muted">{tickedRows.length} ticked</div>
				<div class="text-ink">Received {peso(totalReceived)} · Commission {peso(totalCommission)}</div>
			</div>
			{#if !confirming}
				<Button type="button" disabled={blocked} onclick={() => (confirming = true)}>Record payout</Button>
			{:else}
				<div class="flex items-center gap-2">
					<span class="text-sm text-ink">Bank receives {peso(totalReceived)}; {tickedRows.length} booking(s) close.</span>
					<Button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Confirm'}</Button>
					<Button type="button" variant="ghost" onclick={() => (confirming = false)}>Back</Button>
				</div>
			{/if}
		</div>
	</form>
{/if}
