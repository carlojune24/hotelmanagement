<script lang="ts">
	import { enhance } from '$app/forms';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	type Cashier = {
		requireOpenShiftForCashPayment: boolean;
		hasBankAccount: boolean;
		openShift: { id: string; drawerId: string } | null;
	};

	let {
		action,
		kind,
		id,
		balanceCentavos,
		cashier,
		mode = 'payment',
		onDone
	}: {
		action: string;
		kind: 'room' | 'hall';
		id: string;
		/** Positive = amount owed (payment mode). For refund mode this is the credit available. */
		balanceCentavos: number;
		cashier: Cashier;
		mode?: 'payment' | 'refund';
		onDone?: () => void;
	} = $props();

	const peso = (c: number) => `₱${(c / 100).toFixed(2)}`;
	const METHODS = [
		{ v: 'cash', label: 'Cash' },
		{ v: 'card', label: 'Card' },
		{ v: 'gcash', label: 'GCash' },
		{ v: 'maya', label: 'Maya' },
		{ v: 'bank_transfer', label: 'Bank transfer' },
		{ v: 'cheque', label: 'Cheque' }
	] as const;

	let method = $state<'cash' | 'card' | 'gcash' | 'maya' | 'bank_transfer' | 'cheque'>('cash');
	let amount = $state((balanceCentavos / 100).toFixed(2));
	let tendered = $state('');
	let submitting = $state(false);

	const amountCentavos = $derived(Math.round(parseFloat(amount || '0') * 100));
	const tenderedCentavos = $derived(Math.round(parseFloat(tendered || '0') * 100));
	const changeCentavos = $derived(
		method === 'cash' && tendered !== '' ? tenderedCentavos - amountCentavos : 0
	);
	const needsReference = $derived(
		['card', 'gcash', 'maya', 'bank_transfer', 'cheque'].includes(method)
	);
	const cashBlocked = $derived(
		mode === 'payment' &&
			method === 'cash' &&
			cashier.requireOpenShiftForCashPayment &&
			!cashier.openShift
	);
	const overpayBlocked = $derived(
		mode === 'payment' && method !== 'cash' && amountCentavos > balanceCentavos
	);

	const canSubmit = $derived(
		!submitting &&
			amountCentavos > 0 &&
			amountCentavos <=
				(mode === 'payment' && method === 'cash' ? Number.MAX_SAFE_INTEGER : balanceCentavos) &&
			!cashBlocked &&
			!overpayBlocked &&
			!(method === 'cash' && mode === 'payment' && tendered !== '' && changeCentavos < 0)
	);

	function setFull() {
		amount = (balanceCentavos / 100).toFixed(2);
	}
	function setHalf() {
		amount = (Math.round(balanceCentavos / 2) / 100).toFixed(2);
	}
	function addTender(n: number) {
		tendered = (Math.max(0, tenderedCentavos) / 100 + n).toFixed(2);
	}
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
	<input type="hidden" name="kind" value={kind} />
	<input type="hidden" name="id" value={id} />

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
			<Label class="text-xs">{mode === 'refund' ? 'Refund amount' : 'Amount'} (₱)</Label>
			<Input name="amount" type="number" min="0.01" step="0.01" bind:value={amount} class="mt-1" />
		</div>
	</div>

	{#if mode === 'payment'}
		<div class="flex gap-1.5">
			<button
				type="button"
				onclick={setFull}
				class="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface"
			>
				Full {peso(balanceCentavos)}
			</button>
			<button
				type="button"
				onclick={setHalf}
				class="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface"
			>
				50% deposit
			</button>
		</div>
	{/if}

	{#if method === 'cash' && mode === 'payment'}
		<div>
			<Label class="text-xs">Cash tendered (₱)</Label>
			<Input
				name="tendered"
				type="number"
				min="0"
				step="0.01"
				bind:value={tendered}
				class="mt-1"
				placeholder={amount}
			/>
			<div class="mt-1.5 flex flex-wrap gap-1">
				{#each [1000, 500, 200, 100, 50, 20] as d (d)}
					<button
						type="button"
						onclick={() => addTender(d)}
						class="rounded border border-border px-1.5 py-0.5 text-[11px] tabular-nums hover:bg-surface"
					>
						+{d}
					</button>
				{/each}
				<button
					type="button"
					onclick={() => (tendered = '')}
					class="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-surface"
				>
					clear
				</button>
			</div>
			{#if tendered !== ''}
				<p class="mt-1.5 text-sm font-semibold {changeCentavos < 0 ? 'text-danger' : 'text-ok'}">
					{changeCentavos < 0 ? 'Short by ' : 'Change due '}{peso(Math.abs(changeCentavos))}
				</p>
			{/if}
		</div>
	{/if}

	{#if needsReference}
		<div class="grid grid-cols-2 gap-2">
			<div class={method === 'cheque' || method === 'bank_transfer' ? '' : 'col-span-2'}>
				<Label class="text-xs">
					{method === 'card'
						? 'Approval / reference no.'
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

	{#if mode === 'refund'}
		<div>
			<Label class="text-xs">Reason</Label>
			<Input name="reason" maxlength={300} class="mt-1" placeholder="Why the money is going back" />
		</div>
	{/if}

	{#if cashBlocked}
		<p class="text-xs text-danger">
			Open a cashier shift before taking cash — other methods still work.
		</p>
	{/if}
	{#if overpayBlocked}
		<p class="text-xs text-danger">
			Only cash can be over-tendered. Enter {peso(balanceCentavos)} or less.
		</p>
	{/if}
	{#if !cashier.hasBankAccount && needsReference}
		<p class="text-xs text-danger">No bank / e-wallet account is set up in Finance settings yet.</p>
	{/if}

	<Button type="submit" size="sm" class="w-full" disabled={!canSubmit}>
		{mode === 'refund'
			? 'Record refund'
			: method === 'cash'
				? 'Take cash payment'
				: 'Record payment'}
	</Button>
</form>
