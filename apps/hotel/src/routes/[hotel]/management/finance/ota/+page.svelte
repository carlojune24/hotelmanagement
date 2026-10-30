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
	const otaLabel = (n: string) => n.charAt(0).toUpperCase() + n.slice(1);
	/** 2026-10-30 -> Oct 30 */
	const day = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');

	type Row = PageData['rows'][number];
	/** Ticked receivable ids → the amount typed as received (pesos), prefilled with the expected net. */
	let received = $state<Record<string, string>>({});
	let statementRef = $state('');
	let confirming = $state(false);
	let busy = $state(false);

	$effect(() => {
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			received = {};
			statementRef = '';
			confirming = false;
		}
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	const groups = $derived.by(() => {
		const by = new Map<string, Row[]>();
		for (const r of data.rows) {
			const k = r.ota?.name ?? 'other';
			by.set(k, [...(by.get(k) ?? []), r]);
		}
		return [...by.entries()].map(([name, rows]) => ({
			name,
			rows,
			expectedNet: rows.reduce((n, r) => n + expected(r), 0)
		}));
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
	function toggleGroup(rows: Row[], on: boolean) {
		const next = { ...received };
		for (const r of rows) {
			if (on) next[r.id] ??= (expected(r) / 100).toFixed(2);
			else delete next[r.id];
		}
		received = next;
		confirming = false;
	}

	const tickedRows = $derived(data.rows.filter(ticked));
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
	<div class="mb-5">
		<h1 class="text-xl font-semibold tracking-tight text-ink">OTA payouts</h1>
		<p class="text-sm text-ink-muted">Bookings the OTA collected from guests and still owes you, net of its commission.</p>
	</div>

	{#if groups.length > 0}
		<div class="mb-6 flex flex-wrap gap-3">
			{#each groups as g (g.name)}
				<div class="rounded-xl border border-border px-4 py-3">
					<div class="text-xs text-ink-muted">{otaLabel(g.name)}</div>
					<div class="mt-1 text-lg font-semibold text-ink tabular-nums">{peso(g.expectedNet)}</div>
					<div class="text-xs text-ink-muted">{g.rows.length} booking(s) awaiting payout</div>
				</div>
			{/each}
		</div>
	{/if}

	{#each groups as g (g.name)}
		<section class="mb-6">
			<h2 class="mb-2 text-sm font-semibold text-ink">{otaLabel(g.name)}</h2>
			<div class="overflow-x-auto rounded-xl border border-border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="w-10">
								<Checkbox checked={g.rows.every(ticked)} onCheckedChange={(v) => toggleGroup(g.rows, v === true)} aria-label="Select all {g.name} bookings" />
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
						{#each g.rows as r (r.id)}
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
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</section>
	{:else}
		<div class="rounded-xl border border-border p-8 text-center">
			<p class="font-medium text-ink">No OTA bookings are waiting for a payout.</p>
			<p class="mt-1 text-sm text-ink-muted">
				Add one from Front desk → Walk-in → OTA booking. It shows up here until the OTA pays it out.
			</p>
		</div>
	{/each}
</div>

{#if data.rows.length > 0 && data.finance.canReceivable}
	<form
		method="POST"
		action="?/record"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update();
				busy = false;
			};
		}}
		class="sticky bottom-0 z-10 border-t border-border bg-surface px-4 py-3 sm:px-6"
	>
		<input type="hidden" name="itemsJson" value={itemsJson} />
		<div class="mx-auto flex w-full max-w-5xl flex-wrap items-end gap-3">
			<div class="min-w-52 flex-1">
				<Label for="otaStatementRef" class="text-xs">OTA statement or payment reference</Label>
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
