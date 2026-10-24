<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';

	/** One open shift, as `finance/shifts.ts`'s `getShiftReconciliation` returns it. Shared by
	 *  Finance → Shifts (every drawer) and Dining → Drawer (dining's own), so a cashier counts
	 *  their till the same way wherever they stand. Both pages expose `?/shiftEvent` and
	 *  `?/closeShift`. */
	type Recon = {
		shift: { id: string; openedAt: string | Date };
		drawerName: string;
		openedByName: string | null;
		openingFloatCentavos: number;
		cashInCentavos: number;
		cashOutCentavos: number;
		expectedCashCentavos: number;
		byMethod: { method: string; amountCentavos: number; count: number }[];
	};

	let {
		recon,
		expenseCategories
	}: { recon: Recon; expenseCategories: { id: string; name: string }[] } = $props();

	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const fmt = (d: string | Date) =>
		new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

	let counted = $state('');
	const variance = $derived.by(() => {
		const c = parseFloat(counted || '');
		return Number.isFinite(c) ? Math.round(c * 100) - recon.expectedCashCentavos : null;
	});

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
	let eventKind = $state<EventKind>('payout');
</script>

<div class="mb-5 rounded-xl border border-ok/40 bg-ok/5 p-4">
	<div class="mb-2 flex items-center justify-between">
		<div>
			<span class="font-semibold text-ink">{recon.drawerName}</span>
			<Badge variant="outline" class="ml-2 border-transparent bg-ok/15 text-ok">Open</Badge>
		</div>
		<span class="text-xs text-ink-muted"
			>Opened {fmt(recon.shift.openedAt)} by {recon.openedByName ?? '—'}</span
		>
	</div>

	<div class="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
		<div>
			<div class="text-xs text-ink-muted">Opening float</div>
			<div class="tabular-nums text-ink">{peso(recon.openingFloatCentavos)}</div>
		</div>
		<div>
			<div class="text-xs text-ink-muted">Cash in</div>
			<div class="tabular-nums text-ok">{peso(recon.cashInCentavos)}</div>
		</div>
		<div>
			<div class="text-xs text-ink-muted">Cash out / drops</div>
			<div class="tabular-nums text-danger">{peso(recon.cashOutCentavos)}</div>
		</div>
		<div>
			<div class="text-xs text-ink-muted">Expected in drawer</div>
			<div class="tabular-nums font-semibold text-ink">{peso(recon.expectedCashCentavos)}</div>
		</div>
	</div>

	{#if recon.byMethod.length > 0}
		<div class="mb-3 flex flex-wrap gap-3 text-xs text-ink-muted">
			{#each recon.byMethod as m (m.method)}<span
					>{m.method}: {peso(m.amountCentavos)} ({m.count})</span
				>{/each}
		</div>
	{/if}

	<div class="grid gap-3 sm:grid-cols-2">
		<form method="POST" action="?/shiftEvent" use:enhance class="rounded-lg border border-border p-3">
			<input type="hidden" name="shiftId" value={recon.shift.id} />
			<div class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
				Drawer event
			</div>
			<div class="flex flex-wrap items-end gap-2">
				<div>
					<Label class="text-xs">Event</Label>
					<select
						name="kind"
						bind:value={eventKind}
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
						{eventKind === 'payout' ? 'Paid to / for' : 'Note (optional)'}
					</Label>
					<Input name="reason" class="mt-1 h-8" />
				</div>
				{#if eventKind === 'payout'}
					<div>
						<Label class="text-xs">Expense category</Label>
						<select
							name="expenseCategoryId"
							class="mt-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
						>
							<option value="">— Uncategorised —</option>
							{#each expenseCategories as c (c.id)}
								<option value={c.id}>{c.name}</option>
							{/each}
						</select>
					</div>
					<label class="flex items-center gap-1.5 pb-2 text-xs text-ink-muted">
						<input type="checkbox" name="isVatable" value="1" class="size-3.5" /> VAT-incl.
					</label>
				{/if}
				<Button type="submit" size="sm" variant="outline">Add</Button>
			</div>
			<p class="mt-2 text-xs text-ink-muted">
				{EVENT_DEFS[eventKind].help}
				{#if eventKind === 'payout'}
					Pick a category to also record it as a paid expense (shows in the expense report &amp;
					P&amp;L); leave it Uncategorised for a quick petty cash-out.
				{/if}
			</p>
		</form>

		<form method="POST" action="?/closeShift" use:enhance class="rounded-lg border border-border p-3">
			<input type="hidden" name="shiftId" value={recon.shift.id} />
			<div class="flex flex-wrap items-end gap-2">
				<div>
					<Label class="text-xs">Counted cash (₱)</Label>
					<Input
						name="counted"
						type="number"
						min="0"
						step="0.01"
						bind:value={counted}
						class="mt-1 h-8 w-32"
						required
					/>
				</div>
				<div><Label class="text-xs">Notes</Label><Input name="notes" class="mt-1 h-8" /></div>
				<Button type="submit" size="sm">Close shift</Button>
			</div>
			{#if variance !== null}
				<p
					class="mt-2 text-sm font-semibold {variance < 0
						? 'text-danger'
						: variance > 0
							? 'text-brand'
							: 'text-ok'}"
				>
					{variance === 0 ? 'Balanced' : variance > 0 ? `Over ${peso(variance)}` : `Short ${peso(-variance)}`}
				</p>
			{/if}
		</form>
	</div>
</div>
