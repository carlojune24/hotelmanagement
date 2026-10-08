<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { PageData } from './$types';

	let {
		open = $bindable(false),
		order
	}: {
		open: boolean;
		order: (PageData['orders'][number] | PageData['refundDue'][number]) | null;
	} = $props();

	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const METHODS = [
		{ value: 'gcash', label: 'GCash' },
		{ value: 'maya', label: 'Maya' },
		{ value: 'bank_transfer', label: 'Bank transfer' },
		{ value: 'card', label: 'Card' },
		{ value: 'paymongo_dashboard', label: 'PayMongo dashboard' },
		{ value: 'cash', label: 'Cash' },
		{ value: 'other', label: 'Other' }
	];

	const owed = $derived(order ? Math.max(0, order.totalCentavos - order.refundedCentavos) : 0);
	let amount = $state('');
	let method = $state('gcash');
	let submitting = $state(false);

	$effect(() => {
		if (open) {
			amount = (owed / 100).toFixed(2);
			method = order?.paymentMethod === 'cash' ? 'cash' : 'gcash';
			submitting = false;
		}
	});
	const methodLabel = $derived(METHODS.find((m) => m.value === method)?.label ?? 'Choose');
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		{#if order}
			<Dialog.Header>
				<Dialog.Title>Record a refund for {order.code}</Dialog.Title>
				<Dialog.Description>
					Use this after you have sent the money back yourself (PayMongo dashboard, GCash, bank or cash). It records what you did and
					posts it to Finance. No money moves from here.
				</Dialog.Description>
			</Dialog.Header>

			<div class="flex items-baseline justify-between rounded-lg bg-surface-2 px-4 py-3">
				<span class="text-sm text-ink-muted">Still owed to {order.guestName ?? 'the guest'}</span>
				<span class="text-xl font-semibold tabular-nums text-ink">{peso(owed)}</span>
			</div>

			<form
				method="POST"
				action="?/recordRefund"
				enctype="multipart/form-data"
				class="space-y-3"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						submitting = false;
						await update({ reset: false });
					};
				}}
			>
				<input type="hidden" name="orderId" value={order.id} />
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="rfAmount">Amount sent (₱)</Label>
						<Input id="rfAmount" name="amountPhp" type="number" inputmode="decimal" min="0.01" step="0.01" max={(owed / 100).toFixed(2)} bind:value={amount} required class="mt-1 tabular-nums" />
					</div>
					<div>
						<Label for="rfMethod">How was it sent?</Label>
						<Select.Root type="single" bind:value={method}>
							<Select.Trigger id="rfMethod" class="mt-1 w-full">{methodLabel}</Select.Trigger>
							<Select.Content>
								{#each METHODS as m (m.value)}<Select.Item value={m.value} label={m.label} />{/each}
							</Select.Content>
						</Select.Root>
						<input type="hidden" name="method" value={method} />
					</div>
				</div>
				<div>
					<Label for="rfRef">Reference number (optional)</Label>
					<Input id="rfRef" name="referenceNo" maxlength={80} placeholder="GCash or bank reference" class="mt-1" />
				</div>
				<div>
					<Label for="rfProof">Photo of the receipt or screenshot (optional)</Label>
					<Input id="rfProof" name="proof" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="mt-1" />
					<p class="mt-1 text-xs text-ink-muted">A picture only, up to 8 MB. It is kept with the refund for your records.</p>
				</div>
				<div>
					<Label for="rfNote">Note (optional)</Label>
					<Textarea id="rfNote" name="note" rows={2} maxlength={300} class="mt-1 min-h-0" />
				</div>
				{#if method === 'cash'}
					<p class="text-xs text-ink-muted">Cash refunds come out of the open cashier shift.</p>
				{/if}
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
					<Button type="submit" disabled={submitting || owed <= 0}>{submitting ? 'Recording…' : 'Record refund'}</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
