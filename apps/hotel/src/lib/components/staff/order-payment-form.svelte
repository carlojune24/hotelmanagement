<script lang="ts">
	import { enhance } from '$app/forms';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { planInRoomOrder } from '$lib/allocation';

	type Room = { kind: 'room' | 'hall'; id: string; title: string; balanceCentavos: number };
	type Cashier = {
		requireOpenShiftForCashPayment: boolean;
		hasBankAccount: boolean;
		openShift: { id: string; drawerId: string } | null;
	};

	/** One payment across a booking's rooms: enter what was received, then say which room each part
	 *  pays. The amounts start filled in room order (first room fully first) and every one is editable. */
	let {
		action,
		rooms,
		cashier,
		onDone
	}: { action: string; rooms: Room[]; cashier: Cashier; onDone?: () => void } = $props();

	const peso = (c: number) => `₱${(c / 100).toFixed(2)}`;
	const METHODS = [
		{ v: 'cash', label: 'Cash' },
		{ v: 'card', label: 'Card' },
		{ v: 'gcash', label: 'GCash' },
		{ v: 'maya', label: 'Maya' },
		{ v: 'bank_transfer', label: 'Bank transfer' },
		{ v: 'cheque', label: 'Cheque' }
	] as const;

	const payable = $derived(rooms.filter((r) => r.balanceCentavos > 0));
	const owedCentavos = $derived(payable.reduce((sum, r) => sum + r.balanceCentavos, 0));

	let method = $state<'cash' | 'card' | 'gcash' | 'maya' | 'bank_transfer' | 'cheque'>('cash');
	let amount = $state('');
	let tendered = $state('');
	let submitting = $state(false);
	/** True once staff edit a room's amount: the rooms then drive the total instead of the reverse. */
	let manual = $state(false);
	/** True once staff type in the Amount box: cash received no longer changes the amount. */
	let amountTouched = $state(false);
	let rows = $state<string[]>([]);

	$effect(() => {
		if (amount === '') amount = (owedCentavos / 100).toFixed(2);
	});

	const toCentavos = (v: string) => Math.max(0, Math.round(parseFloat(v || '0') * 100));
	const amountCentavos = $derived(toCentavos(amount));
	const tenderedCentavos = $derived(toCentavos(tendered));

	// Cash received drives the amount (up to what is owed) until the amount is typed by hand.
	$effect(() => {
		if (method !== 'cash' || amountTouched || manual || tendered === '') return;
		const applied = Math.min(tenderedCentavos, owedCentavos);
		if (applied > 0) amount = (applied / 100).toFixed(2);
	});

	// Default split: room order, first room fully first.
	$effect(() => {
		if (manual) return;
		const plan = planInRoomOrder(
			amountCentavos,
			payable.map((r) => ({ id: r.id, balanceCentavos: r.balanceCentavos }))
		);
		rows = plan.allocations.map((a) => (a.amountCentavos / 100).toFixed(2));
	});

	function editRow(i: number, v: string) {
		manual = true;
		rows[i] = v;
		amount = (rows.reduce((sum, r) => sum + toCentavos(r), 0) / 100).toFixed(2);
	}
	function useFullBalance() {
		manual = false;
		amountTouched = true;
		amount = (owedCentavos / 100).toFixed(2);
		tendered = '';
	}

	const assignedCentavos = $derived(rows.reduce((sum, r) => sum + toCentavos(r), 0));
	const overRooms = $derived(payable.filter((r, i) => toCentavos(rows[i] ?? '') > r.balanceCentavos));
	const changeCentavos = $derived(
		method === 'cash' && tendered !== '' ? tenderedCentavos - amountCentavos : 0
	);
	const needsReference = $derived(method !== 'cash');
	const cashBlocked = $derived(
		method === 'cash' && cashier.requireOpenShiftForCashPayment && !cashier.openShift
	);
	const canSubmit = $derived(
		!submitting &&
			amountCentavos > 0 &&
			assignedCentavos === amountCentavos &&
			overRooms.length === 0 &&
			amountCentavos <= owedCentavos &&
			!cashBlocked &&
			!(method === 'cash' && tendered !== '' && changeCentavos < 0)
	);
	const allocationsJson = $derived(
		JSON.stringify(
			payable
				.map((r, i) => ({ kind: r.kind, id: r.id, amount: toCentavos(rows[i] ?? '') / 100 }))
				.filter((a) => a.amount > 0)
		)
	);
</script>

<form
	method="POST"
	{action}
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
			onDone?.();
		};
	}}
	class="space-y-3 rounded-lg border border-border bg-surface-2 p-3"
>
	<input type="hidden" name="allocationsJson" value={allocationsJson} />

	<div class="grid grid-cols-2 gap-2">
		<div>
			<Label class="text-xs">Method</Label>
			<select
				name="method"
				bind:value={method}
				class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
			>
				{#each METHODS as m (m.v)}
					<option value={m.v}>{m.label}</option>
				{/each}
			</select>
		</div>
		<div>
			<Label class="text-xs">Amount to apply (₱)</Label>
			<Input
				type="number"
				min="0.01"
				step="0.01"
				bind:value={amount}
				oninput={() => {
					manual = false;
					amountTouched = true;
				}}
				class="mt-1"
			/>
		</div>
	</div>

	<div class="flex gap-1.5">
		<button
			type="button"
			onclick={useFullBalance}
			class="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface"
		>
			Everything owed {peso(owedCentavos)}
		</button>
	</div>

	{#if method === 'cash'}
		<div>
			<Label class="text-xs">Cash received (₱)</Label>
			<Input name="tendered" type="number" min="0" step="0.01" bind:value={tendered} class="mt-1" />
			{#if tendered !== ''}
				<p class="mt-1.5 text-sm font-semibold {changeCentavos < 0 ? 'text-danger' : 'text-ok'}">
					{changeCentavos < 0 ? 'Short by ' : 'Change due '}{peso(Math.abs(changeCentavos))}
				</p>
			{/if}
		</div>
	{:else}
		<div>
			<Label class="text-xs">
				{method === 'card' ? 'Approval no.' : method === 'cheque' ? 'Cheque no.' : 'Reference no.'}
			</Label>
			<Input name="referenceNo" maxlength={120} class="mt-1" required />
		</div>
		{#if method === 'cheque' || method === 'bank_transfer'}
			<div class="grid grid-cols-2 gap-2">
				<div>
					<Label class="text-xs">Bank</Label>
					<Input name="bankName" maxlength={120} class="mt-1" />
				</div>
				{#if method === 'cheque'}
					<div>
						<Label class="text-xs">Cheque date</Label>
						<Input name="chequeDate" type="date" class="mt-1" />
					</div>
				{/if}
			</div>
		{/if}
	{/if}

	<div>
		<div class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
			Which room does each part pay?
		</div>
		<div class="divide-y divide-border rounded-md border border-border bg-surface">
			{#each payable as r, i (r.id)}
				<div class="flex items-center justify-between gap-3 px-2.5 py-1.5 text-sm">
					<div class="min-w-0">
						<div class="truncate text-ink">{r.title}</div>
						<div class="text-xs text-ink-muted">owes {peso(r.balanceCentavos)}</div>
					</div>
					<Input
						type="number"
						min="0"
						step="0.01"
						value={rows[i] ?? ''}
						oninput={(e) => editRow(i, e.currentTarget.value)}
						class="h-8 w-28 text-right"
					/>
				</div>
			{/each}
		</div>
		<p class="mt-1 text-xs {overRooms.length || assignedCentavos !== amountCentavos ? 'text-danger' : 'text-ink-muted'}">
			{#if overRooms.length}
				{overRooms.map((r) => r.title).join(', ')} was given more than it owes.
			{:else if assignedCentavos !== amountCentavos}
				Assigned {peso(assignedCentavos)} of {peso(amountCentavos)}.
			{:else}
				Assigned {peso(assignedCentavos)} — {peso(owedCentavos - amountCentavos)} still owed on the booking after this.
			{/if}
		</p>
	</div>

	{#if cashBlocked}
		<p class="text-xs text-danger">Open a cashier shift before taking cash — other methods still work.</p>
	{/if}
	{#if method !== 'cash' && !cashier.hasBankAccount}
		<p class="text-xs text-danger">No bank / e-wallet account is set up in Finance settings yet.</p>
	{/if}

	<Button type="submit" size="sm" class="w-full" disabled={!canSubmit}>
		{method === 'cash' ? 'Take cash payment' : 'Record payment'}
	</Button>
</form>
