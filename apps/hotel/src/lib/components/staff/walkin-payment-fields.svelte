<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let {
		totalCentavos,
		cashier
	}: {
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
			{changeCentavos < 0 ? 'Short by ' : 'Change due '}{peso(Math.abs(changeCentavos))}
		</p>
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

	{#if cashBlocked}
		<p class="text-xs text-danger">
			No cashier shift is open — open one from the front-desk header, or use another method.
		</p>
	{/if}
	{#if needsReference && !cashier.hasBankAccount}
		<p class="text-xs text-danger">No bank / e-wallet account set up in Finance settings yet.</p>
	{/if}
</div>
