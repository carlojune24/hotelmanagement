<script lang="ts">
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const r = $derived(data.recon);
	const base = $derived(`/${page.params.hotel}/finance/shifts`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const fmt = (d: string | Date | null) => (d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
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
