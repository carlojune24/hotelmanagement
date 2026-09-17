<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const r = $derived(data.recon);
	const base = $derived(`/${page.params.hotel}/management/finance/shifts`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const fmt = (d: string | Date | null) => (d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

	let chargingBack = $state(false);
	let collecting = $state(false);
	let writingOff = $state(false);
	let submitting = $state(false);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex items-center justify-between print:hidden">
		<a href={base} class="text-sm text-ink-muted underline underline-offset-2">← Shifts</a>
		<Button size="sm" variant="outline" onclick={() => window.print()}>Print</Button>
	</div>

	<h1 class="text-lg font-bold text-ink">Shift reconciliation — {r.drawerName}</h1>
	<p class="mb-4 text-sm text-ink-muted">
		{r.shift.businessDate} ·
		<Badge variant="outline" class={r.shift.status === 'open' ? 'border-transparent bg-ok/15 text-ok' : 'border-border bg-surface-2 text-ink-muted'}>
			{r.shift.status}
		</Badge>
	</p>

	<dl class="mb-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
		<div><dt class="text-xs text-ink-muted">Opened</dt><dd class="text-ink">{fmt(r.shift.openedAt)}</dd></div>
		<div><dt class="text-xs text-ink-muted">Opened by</dt><dd class="text-ink">{r.openedByName ?? '—'}</dd></div>
		<div><dt class="text-xs text-ink-muted">Closed</dt><dd class="text-ink">{fmt(r.shift.closedAt)}</dd></div>
		<div><dt class="text-xs text-ink-muted">Closed by</dt><dd class="text-ink">{r.closedByName ?? '—'}</dd></div>
	</dl>

	<div class="mb-5 rounded-xl border border-border">
		<table class="w-full text-sm">
			<tbody class="divide-y divide-border">
				<tr><td class="px-4 py-2 text-ink-muted">Opening float</td><td class="px-4 py-2 text-right tabular-nums text-ink">{peso(r.openingFloatCentavos)}</td></tr>
				<tr><td class="px-4 py-2 text-ink-muted">+ Cash received</td><td class="px-4 py-2 text-right tabular-nums text-ok">{peso(r.cashInCentavos)}</td></tr>
				<tr><td class="px-4 py-2 text-ink-muted">− Payouts / drops</td><td class="px-4 py-2 text-right tabular-nums text-danger">{peso(r.cashOutCentavos)}</td></tr>
				<tr class="font-semibold"><td class="px-4 py-2 text-ink">Expected in drawer</td><td class="px-4 py-2 text-right tabular-nums text-ink">{peso(r.expectedCashCentavos)}</td></tr>
				{#if r.countedCashCentavos != null}
					<tr><td class="px-4 py-2 text-ink-muted">Counted</td><td class="px-4 py-2 text-right tabular-nums text-ink">{peso(r.countedCashCentavos)}</td></tr>
					<tr class="font-semibold">
						<td class="px-4 py-2 text-ink">Variance</td>
						<td class="px-4 py-2 text-right tabular-nums {(r.varianceCentavos ?? 0) < 0 ? 'text-danger' : (r.varianceCentavos ?? 0) > 0 ? 'text-brand' : 'text-ok'}">
							{peso(r.varianceCentavos ?? 0)}
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>

	{#if (r.varianceCentavos ?? 0) < 0}
		<div class="mb-5 rounded-xl border border-border p-4 print:hidden">
			<h2 class="mb-1 text-sm font-semibold text-ink">Shortage</h2>

			{#if r.shift.varianceChargebackStatus === 'none'}
				<p class="mb-3 text-sm text-ink-muted">
					{peso(Math.abs(r.varianceCentavos ?? 0))} short, not yet acted on.
				</p>
				{#if chargingBack}
					<form
						method="POST"
						action="?/chargeBack"
						use:enhance={() => {
							submitting = true;
							return async ({ update, result }) => {
								await update({ reset: false });
								submitting = false;
								if (result.type === 'success') chargingBack = false;
							};
						}}
						class="space-y-3"
					>
						<div>
							<Label for="cb-amount" class="text-xs">Amount to charge back</Label>
							<Input
								id="cb-amount"
								name="amountCentavos"
								type="number"
								step="0.01"
								min="0"
								max={(Math.abs(r.varianceCentavos ?? 0) / 100).toFixed(2)}
								value={(Math.abs(r.varianceCentavos ?? 0) / 100).toFixed(2)}
								class="mt-1"
							/>
						</div>
						<div>
							<Label for="cb-note" class="text-xs">Note <span class="text-danger">*</span></Label>
							<textarea
								id="cb-note"
								name="note"
								required
								rows="2"
								placeholder="Why is this being charged to the cashier?"
								class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
							></textarea>
						</div>
						<div class="flex gap-2">
							<Button type="submit" size="sm" disabled={submitting}>
								{submitting ? 'Saving…' : 'Confirm charge-back'}
							</Button>
							<Button type="button" variant="ghost" size="sm" onclick={() => (chargingBack = false)}>
								Cancel
							</Button>
						</div>
					</form>
				{:else}
					<Button size="sm" variant="outline" onclick={() => (chargingBack = true)}>
						Charge back to {r.openedByName ?? 'the cashier'}
					</Button>
				{/if}
			{:else if r.shift.varianceChargebackStatus === 'owed'}
				<p class="mb-1 text-sm text-ink">
					<strong>{peso(r.shift.varianceChargebackCentavos ?? 0)}</strong> owed by {r.openedByName ?? 'the cashier'}
				</p>
				{#if r.shift.varianceChargebackNote}
					<p class="mb-3 whitespace-pre-wrap text-xs text-ink-muted">{r.shift.varianceChargebackNote}</p>
				{/if}

				{#if collecting}
					<form
						method="POST"
						action="?/collect"
						use:enhance={() => {
							submitting = true;
							return async ({ update, result }) => {
								await update({ reset: false });
								submitting = false;
								if (result.type === 'success') collecting = false;
							};
						}}
						class="mb-3 space-y-3"
					>
						<div>
							<Label for="collect-account" class="text-xs">Deposit recovered cash into</Label>
							<select
								id="collect-account"
								name="cashAccountId"
								required
								class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
							>
								{#each data.cashAccounts as acct (acct.id)}
									<option value={acct.id} selected={acct.id === r.shift.cashAccountId}>{acct.name}</option>
								{/each}
							</select>
						</div>
						<div class="flex gap-2">
							<Button type="submit" size="sm" disabled={submitting}>
								{submitting ? 'Saving…' : 'Confirm recovered'}
							</Button>
							<Button type="button" variant="ghost" size="sm" onclick={() => (collecting = false)}>
								Cancel
							</Button>
						</div>
					</form>
				{:else if writingOff}
					<form
						method="POST"
						action="?/writeOff"
						use:enhance={() => {
							submitting = true;
							return async ({ update, result }) => {
								await update({ reset: false });
								submitting = false;
								if (result.type === 'success') writingOff = false;
							};
						}}
						class="mb-3 space-y-3"
					>
						<div>
							<Label for="wo-note" class="text-xs">Reason <span class="text-danger">*</span></Label>
							<textarea
								id="wo-note"
								name="note"
								required
								rows="2"
								placeholder="Why is the hotel absorbing this instead of collecting it?"
								class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
							></textarea>
						</div>
						<div class="flex gap-2">
							<Button type="submit" size="sm" variant="destructive" disabled={submitting}>
								{submitting ? 'Saving…' : 'Confirm write-off'}
							</Button>
							<Button type="button" variant="ghost" size="sm" onclick={() => (writingOff = false)}>
								Cancel
							</Button>
						</div>
					</form>
				{:else}
					<div class="flex gap-2">
						<Button size="sm" onclick={() => (collecting = true)}>Mark collected</Button>
						<Button size="sm" variant="outline" onclick={() => (writingOff = true)}>Write off</Button>
					</div>
				{/if}
			{:else if r.shift.varianceChargebackStatus === 'collected'}
				<Badge variant="outline" class="border-transparent bg-ok/15 text-ok">Recovered</Badge>
				<p class="mt-2 text-sm text-ink">
					{peso(r.shift.varianceChargebackCentavos ?? 0)} recovered from {r.openedByName ?? 'the cashier'}
					on {fmt(r.shift.varianceChargebackCollectedAt)}
					{#if r.chargebackCollectedByName}by {r.chargebackCollectedByName}{/if}.
				</p>
			{:else if r.shift.varianceChargebackStatus === 'written_off'}
				<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted">Written off</Badge>
				{#if r.shift.varianceChargebackNote}
					<p class="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{r.shift.varianceChargebackNote}</p>
				{/if}
			{/if}
		</div>
	{/if}

	{#if r.byMethod.length > 0}
		<h2 class="mb-2 text-sm font-semibold text-ink">Payments taken this shift</h2>
		<div class="mb-5 overflow-x-auto rounded-xl border border-border">
			<Table.Root>
				<Table.Body>
					{#each r.byMethod as m (m.method)}
						<Table.Row>
							<Table.Cell class="text-ink-muted capitalize">{m.method.replace('_', ' ')}</Table.Cell>
							<Table.Cell class="text-ink-muted">{m.count} payment(s)</Table.Cell>
							<Table.Cell class="text-right tabular-nums text-ink">{peso(m.amountCentavos)}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}

	{#if r.events.length > 0}
		<h2 class="mb-2 text-sm font-semibold text-ink">Shift events</h2>
		<div class="overflow-x-auto rounded-xl border border-border">
			<Table.Root>
				<Table.Body>
					{#each r.events as e (e.id)}
						<Table.Row>
							<Table.Cell class="text-ink-muted capitalize">{e.kind.replace('_', ' ')}</Table.Cell>
							<Table.Cell class="text-ink-muted">{e.reason ?? ''}</Table.Cell>
							<Table.Cell class="text-right tabular-nums text-ink">{peso(e.amountCentavos)}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}

	{#if r.shift.closeNotes}
		<p class="mt-4 text-sm text-ink-muted"><strong class="text-ink">Notes:</strong> {r.shift.closeNotes}</p>
	{/if}
</div>
