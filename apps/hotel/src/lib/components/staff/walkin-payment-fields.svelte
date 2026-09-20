<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { planInRoomOrder } from '$lib/allocation';

	let {
		totalCentavos,
		cashier,
		rooms = []
	}: {
		/** The rooms being booked (cart order). With more than one, the payment can be split across
		 *  them — filled in room order by default, every amount editable. */
		rooms?: { label: string; totalCentavos: number }[];
		/** The full amount the walk-in will be charged (server re-prices; shown here for the change calc). */
		totalCentavos: number | null;
		cashier: {
			requireOpenShiftForCashPayment: boolean;
			openShift: { id: string } | null;
			hasBankAccount: boolean;
		};
	} = $props();

	const peso = (c: number) => `₱${(c / 100).toFixed(2)}`;
	let method = $state<'cash' | 'card' | 'gcash' | 'maya' | 'bank_transfer' | 'cheque'>('cash');
	let tendered = $state('');

	const tenderedCentavos = $derived(Math.round(parseFloat(tendered || '0') * 100));
	const changeCentavos = $derived(
		totalCentavos != null && tendered !== '' ? tenderedCentavos - totalCentavos : 0
	);
	const needsReference = $derived(
		['card', 'gcash', 'maya', 'bank_transfer', 'cheque'].includes(method)
	);
	// What this walk-in actually pays now: everything, or (cash) what was handed over, up to the total.
	const paidNowCentavos = $derived(
		method === 'cash' && tendered !== '' && totalCentavos != null
			? Math.min(totalCentavos, Math.max(0, tenderedCentavos))
			: (totalCentavos ?? 0)
	);
	const multi = $derived(rooms.length > 1);
	let manualSplit = $state(false);
	let rows = $state<string[]>([]);
	$effect(() => {
		if (manualSplit) return;
		const plan = planInRoomOrder(
			paidNowCentavos,
			rooms.map((r, i) => ({ id: String(i), balanceCentavos: r.totalCentavos }))
		);
		rows = plan.allocations.map((a) => (a.amountCentavos / 100).toFixed(2));
	});
	const rowCents = (v: string) => Math.max(0, Math.round(parseFloat(v || '0') * 100));
	const assignedCentavos = $derived(rows.reduce((sum, v) => sum + rowCents(v), 0));
	const splitProblem = $derived(
		!multi
			? null
			: assignedCentavos !== paidNowCentavos
				? `Assigned ${peso(assignedCentavos)} of ${peso(paidNowCentavos)}.`
				: rooms.some((r, i) => rowCents(rows[i] ?? '') > r.totalCentavos)
					? 'A room was given more than its bill.'
					: null
	);
	const cashBlocked = $derived(
		method === 'cash' && cashier.requireOpenShiftForCashPayment && !cashier.openShift
	);
</script>

<div class="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
	<div class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Payment</div>
	<div class="grid grid-cols-2 gap-2">
		<div>
			<Label class="text-xs">Method</Label>
			<select
				name="method"
				bind:value={method}
				class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
			>
				<option value="cash">Cash</option>
				<option value="card">Card</option>
				<option value="gcash">GCash</option>
				<option value="maya">Maya</option>
				<option value="bank_transfer">Bank transfer</option>
				<option value="cheque">Cheque</option>
			</select>
		</div>
		{#if method === 'cash'}
			<div>
				<Label class="text-xs">Cash tendered (₱)</Label>
				<Input
					name="tendered"
					type="number"
					min="0"
					step="0.01"
					bind:value={tendered}
					class="mt-1"
				/>
			</div>
		{/if}
	</div>

	{#if method === 'cash' && tendered !== '' && totalCentavos != null}
		<p class="text-sm font-semibold {changeCentavos < 0 ? 'text-danger' : 'text-ok'}">
			{changeCentavos < 0 ? 'Balance still due ' : 'Change due '}{peso(Math.abs(changeCentavos))}
		</p>
		{#if changeCentavos < 0}
			<p class="text-xs text-ink-muted">
				Only the {peso(tenderedCentavos)} received is recorded as paid; the balance stays on the
				folio to collect later or move to the city ledger at check-out.
			</p>
		{/if}
	{/if}

	{#if needsReference}
		<div class="grid grid-cols-2 gap-2">
			<div class={method === 'cheque' || method === 'bank_transfer' ? '' : 'col-span-2'}>
				<Label class="text-xs">
					{method === 'card'
						? 'Approval no.'
						: method === 'cheque'
							? 'Cheque no.'
							: 'Reference no.'}
				</Label>
				<Input name="referenceNo" maxlength={120} class="mt-1" required />
			</div>
			{#if method === 'cheque' || method === 'bank_transfer'}
				<div>
					<Label class="text-xs">Bank</Label>
					<Input name="bankName" maxlength={120} class="mt-1" />
				</div>
			{/if}
			{#if method === 'cheque'}
				<div class="col-span-2">
					<Label class="text-xs">Cheque date</Label>
					<Input name="chequeDate" type="date" class="mt-1" />
				</div>
			{/if}
		</div>
	{/if}

	{#if multi}
		<div>
			<div class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
				Which room does each part pay?
			</div>
			<div class="divide-y divide-border rounded-md border border-border bg-surface">
				{#each rooms as r, i (i)}
					<div class="flex items-center justify-between gap-3 px-2.5 py-1.5 text-sm">
						<div class="min-w-0">
							<div class="truncate text-ink">{r.label}</div>
							<div class="text-xs text-ink-muted">bill {peso(r.totalCentavos)}</div>
						</div>
						<Input
							type="number"
							min="0"
							step="0.01"
							value={rows[i] ?? ''}
							oninput={(e) => {
								manualSplit = true;
								rows[i] = e.currentTarget.value;
							}}
							class="h-8 w-28 text-right"
						/>
					</div>
				{/each}
			</div>
			<p class="mt-1 text-xs {splitProblem ? 'text-danger' : 'text-ink-muted'}">
				{splitProblem ?? `Paying ${peso(paidNowCentavos)} now — ${peso((totalCentavos ?? 0) - paidNowCentavos)} stays owed, room by room.`}
			</p>
			{#if manualSplit}
				<input type="hidden" name="allocationsJson" value={JSON.stringify(rows.map((v) => rowCents(v) / 100))} />
				<button
					type="button"
					class="mt-1 text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
					onclick={() => (manualSplit = false)}>Reset to room order</button
				>
			{/if}
		</div>
	{/if}

	{#if cashBlocked}
		<p class="text-xs text-danger">
			No cashier shift is open — open one from the front-desk header, or use another method.
		</p>
	{/if}
	{#if needsReference && !cashier.hasBankAccount}
		<p class="text-xs text-danger">No bank / e-wallet account set up in Finance settings yet.</p>
	{/if}
</div>
