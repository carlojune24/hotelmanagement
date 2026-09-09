<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/finance/shifts`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const fmt = (d: string | Date) =>
		new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	let counted = $state<Record<string, string>>({});
	const varianceOf = (r: (typeof data.openReconciliations)[number]) => {
		const c = parseFloat(counted[r.shift.id] || '');
		return Number.isFinite(c) ? Math.round(c * 100) - r.expectedCashCentavos : null;
	};

	// Shift-event kinds, with a plain-language definition shown under the picker.
	type EventKind = 'payout' | 'cash_drop' | 'pickup';
	const EVENT_DEFS: Record<EventKind, { label: string; help: string }> = {
		payout: {
			label: 'Payout',
			help: 'Cash paid straight out of the drawer for a small expense (e.g. a delivery, a quick supply run). Reduces the drawer; posts an expense in Finance.'
		},
		cash_drop: {
			label: 'Cash drop → bank',
			help: 'Move surplus cash out of the drawer to the bank/safe mid-shift so the till isn’t holding too much. Drawer down, bank up — no expense, just a transfer.'
		},
		pickup: {
			label: 'Float pickup ← bank',
			help: 'Top the drawer back up from the bank/safe when it’s running low on change. Bank down, drawer up — a transfer, not income.'
		}
	};
	let eventKind = $state<Record<string, EventKind>>({});
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
	<h1 class="mb-4 text-xl font-semibold tracking-tight text-ink">Cashier shifts</h1>

	{#each data.openReconciliations as r (r.shift.id)}
		<div class="mb-5 rounded-xl border border-ok/40 bg-ok/5 p-4">
			<div class="mb-2 flex items-center justify-between">
				<div>
					<span class="font-semibold text-ink">{r.drawerName}</span>
					<Badge variant="outline" class="ml-2 border-transparent bg-ok/15 text-ok">Open</Badge>
				</div>
				<span class="text-xs text-ink-muted"
					>Opened {fmt(r.shift.openedAt)} by {r.openedByName ?? '—'}</span
				>
			</div>

			<div class="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
				<div>
					<div class="text-xs text-ink-muted">Opening float</div>
					<div class="tabular-nums text-ink">{peso(r.openingFloatCentavos)}</div>
				</div>
				<div>
					<div class="text-xs text-ink-muted">Cash in</div>
					<div class="tabular-nums text-ok">{peso(r.cashInCentavos)}</div>
				</div>
				<div>
					<div class="text-xs text-ink-muted">Cash out / drops</div>
					<div class="tabular-nums text-danger">{peso(r.cashOutCentavos)}</div>
				</div>
				<div>
					<div class="text-xs text-ink-muted">Expected in drawer</div>
					<div class="tabular-nums font-semibold text-ink">{peso(r.expectedCashCentavos)}</div>
				</div>
			</div>

			{#if r.byMethod.length > 0}
				<div class="mb-3 flex flex-wrap gap-3 text-xs text-ink-muted">
					{#each r.byMethod as m (m.method)}<span
							>{m.method}: {peso(m.amountCentavos)} ({m.count})</span
						>{/each}
				</div>
			{/if}

			<div class="grid gap-3 sm:grid-cols-2">
				<form
					method="POST"
					action="?/shiftEvent"
					use:enhance
					class="rounded-lg border border-border p-3"
				>
					<input type="hidden" name="shiftId" value={r.shift.id} />
					<div class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
						Drawer event
					</div>
					<div class="flex flex-wrap items-end gap-2">
						<div>
							<Label class="text-xs">Event</Label>
							<select
								name="kind"
								bind:value={eventKind[r.shift.id]}
								class="mt-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
							>
								{#each Object.entries(EVENT_DEFS) as [value, def] (value)}
									<option {value}>{def.label}</option>
								{/each}
							</select>
						</div>
						<div>
							<Label class="text-xs">Amount (₱)</Label><Input
								name="amount"
								type="number"
								min="0.01"
								step="0.01"
								class="mt-1 h-8 w-28"
							/>
						</div>
						<div class="min-w-[8rem] flex-1">
							<Label class="text-xs">
								{(eventKind[r.shift.id] ?? 'payout') === 'payout'
									? 'Paid to / for'
									: 'Note (optional)'}
							</Label>
							<Input name="reason" class="mt-1 h-8" />
						</div>
						<Button type="submit" size="sm" variant="outline">Add</Button>
					</div>
					<p class="mt-2 text-xs text-ink-muted">
						{EVENT_DEFS[eventKind[r.shift.id] ?? 'payout'].help}
					</p>
				</form>

				<form
					method="POST"
					action="?/closeShift"
					use:enhance
					class="rounded-lg border border-border p-3"
				>
					<input type="hidden" name="shiftId" value={r.shift.id} />
					<div class="flex flex-wrap items-end gap-2">
						<div>
							<Label class="text-xs">Counted cash (₱)</Label>
							<Input
								name="counted"
								type="number"
								min="0"
								step="0.01"
								bind:value={counted[r.shift.id]}
								class="mt-1 h-8 w-32"
								required
							/>
						</div>
						<div><Label class="text-xs">Notes</Label><Input name="notes" class="mt-1 h-8" /></div>
						<Button type="submit" size="sm">Close shift</Button>
					</div>
					{#if varianceOf(r) !== null}
						<p
							class="mt-2 text-sm font-semibold {varianceOf(r)! < 0
								? 'text-danger'
								: varianceOf(r)! > 0
									? 'text-brand'
									: 'text-ok'}"
						>
							{varianceOf(r)! === 0
								? 'Balanced'
								: varianceOf(r)! > 0
									? `Over ${peso(varianceOf(r)!)}`
									: `Short ${peso(-varianceOf(r)!)}`}
						</p>
					{/if}
				</form>
			</div>
		</div>
	{/each}

	<h2 class="mb-2 mt-6 text-sm font-semibold text-ink">Shift history</h2>
	<div class="overflow-x-auto rounded-xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Date</Table.Head>
					<Table.Head>Drawer</Table.Head>
					<Table.Head>Cashier</Table.Head>
					<Table.Head class="text-right">Opening</Table.Head>
					<Table.Head class="text-right">Expected</Table.Head>
					<Table.Head class="text-right">Counted</Table.Head>
					<Table.Head class="text-right">Variance</Table.Head>
					<Table.Head></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.shifts as s (s.id)}
					<Table.Row>
						<Table.Cell class="whitespace-nowrap text-ink-muted">{s.businessDate}</Table.Cell>
						<Table.Cell class="text-ink">{s.drawerName}</Table.Cell>
						<Table.Cell class="text-ink-muted">{s.openedByName ?? '—'}</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ink-muted"
							>{peso(s.openingFloatCentavos)}</Table.Cell
						>
						<Table.Cell class="text-right tabular-nums text-ink-muted"
							>{s.expectedCashCentavos != null ? peso(s.expectedCashCentavos) : '—'}</Table.Cell
						>
						<Table.Cell class="text-right tabular-nums text-ink"
							>{s.countedCashCentavos != null ? peso(s.countedCashCentavos) : '—'}</Table.Cell
						>
						<Table.Cell
							class="text-right tabular-nums {s.varianceCentavos
								? s.varianceCentavos < 0
									? 'text-danger'
									: 'text-brand'
								: 'text-ink-muted'}"
						>
							{s.varianceCentavos != null ? peso(s.varianceCentavos) : '—'}
						</Table.Cell>
						<Table.Cell class="text-right"
							><a href="{base}/{s.id}" class="text-xs underline underline-offset-2">Details</a
							></Table.Cell
						>
					</Table.Row>
				{:else}
					<Table.Row
						><Table.Cell colspan={8} class="py-6 text-center text-ink-muted"
							>No shifts yet.</Table.Cell
						></Table.Row
					>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
