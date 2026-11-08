<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import DiscountFields from './discount-fields.svelte';

	/**
	 * Senior / PWD on an order already paid in full (a pre-order paid ahead, or a guest who shows their ID
	 * late): their share is discounted, the difference goes back to the guest, and the receipt is issued
	 * again. Posts `?/discountAfterPayment` (managers only).
	 */
	let {
		open = $bindable(false),
		order
	}: {
		open: boolean;
		order: { id: string; code: string; guestName: string | null; totalCentavos: number; vatCentavos: number } | null;
	} = $props();

	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const METHODS = [
		{ value: 'cash', label: 'Cash' },
		{ value: 'gcash', label: 'GCash' },
		{ value: 'maya', label: 'Maya' },
		{ value: 'card', label: 'Card reversal' },
		{ value: 'bank_transfer', label: 'Bank transfer' },
		{ value: 'paymongo_dashboard', label: 'PayMongo refund' },
		{ value: 'other', label: 'Other' }
	] as const;

	let discount = $state<{ net: number; less: number; label: string } | null>(null);
	let ready = $state(true);
	let method = $state('cash');
	let referenceNo = $state('');
	let submitting = $state(false);
	let done = $state<{ refundCentavos: number; netCentavos: number; documents: string[]; documentError: string | null } | null>(null);
	// The picker keeps its guests between openings unless it is rebuilt: key it on each opening.
	let session = $state(0);

	$effect(() => {
		if (!open) return;
		untrack(() => {
			method = 'cash';
			referenceNo = '';
			submitting = false;
			done = null;
			session++;
		});
	});

	const refund = $derived(discount ? (order?.totalCentavos ?? 0) - discount.net : 0);
	const methodLabel = $derived(METHODS.find((m) => m.value === method)?.label ?? 'Choose');
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
		{#if order}
			{#if done}
				<div class="space-y-4 py-2 text-center">
					<CircleCheckIcon class="mx-auto size-10 text-brand" aria-hidden="true" />
					<div>
						<Dialog.Title class="text-lg">Refund {peso(done.refundCentavos)}</Dialog.Title>
						<p class="mt-1 text-sm text-ink-muted">{order.code} now totals {peso(done.netCentavos)} with the Senior / PWD discount.</p>
					</div>
					{#if done.documents.length > 0}
						<p class="text-sm text-ink">Receipt issued again: <span class="font-medium tabular-nums">{done.documents.join(', ')}</span></p>
					{/if}
					{#if done.documentError}
						<p class="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-ink" role="alert">
							The refund is recorded, but the receipt could not be issued again: {done.documentError}
						</p>
					{/if}
					<Button class="h-11 w-full" onclick={() => (open = false)}>Done</Button>
				</div>
			{:else}
				<Dialog.Header>
					<Dialog.Title>Senior / PWD after payment</Dialog.Title>
					<Dialog.Description>
						{order.code}{order.guestName ? `, ${order.guestName}` : ''}. Only the qualifying guests' share is discounted. The difference goes back to the guest.
					</Dialog.Description>
				</Dialog.Header>

				<form
					method="POST"
					action="?/discountAfterPayment"
					class="space-y-4"
					use:enhance={() => {
						submitting = true;
						return async ({ result, update }) => {
							submitting = false;
							if (result.type === 'success' && result.data?.discounted) {
								done = result.data.discounted as NonNullable<typeof done>;
								await invalidateAll();
							} else {
								await update({ reset: false });
							}
						};
					}}
				>
					<input type="hidden" name="orderId" value={order.id} />
					{#key session}
						<DiscountFields orders={[order]} only="sc_pwd" bind:discount bind:ready />
					{/key}

					<dl class="grid grid-cols-[1fr_auto] gap-y-1 rounded-lg bg-surface-2 px-4 py-3 text-sm" aria-live="polite">
						<dt class="text-ink-muted">Paid</dt>
						<dd class="text-right tabular-nums text-ink">{peso(order.totalCentavos)}</dd>
						<dt class="text-ink-muted">New total</dt>
						<dd class="text-right tabular-nums text-ink">{discount ? peso(discount.net) : '—'}</dd>
						<dt class="font-medium text-ink">Refund to the guest</dt>
						<dd class="text-right text-lg font-semibold tabular-nums text-ink">{discount ? peso(refund) : '—'}</dd>
					</dl>

					<div class="grid grid-cols-2 gap-3">
						<div>
							<Label for="dapMethod" class="text-xs">Refund by</Label>
							<Select.Root type="single" name="method" bind:value={method}>
								<Select.Trigger id="dapMethod" class="mt-1 w-full">{methodLabel}</Select.Trigger>
								<Select.Content>
									{#each METHODS as m (m.value)}<Select.Item value={m.value} label={m.label} />{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div>
							<Label for="dapRef" class="text-xs">Reference no. {method === 'cash' ? '(optional)' : ''}</Label>
							<Input id="dapRef" name="referenceNo" maxlength={80} autocomplete="off" bind:value={referenceNo} class="mt-1" />
						</div>
					</div>
					{#if method === 'cash'}
						<p class="text-xs text-ink-muted">Cash comes out of the dining drawer, so a shift must be open.</p>
					{/if}

					<Dialog.Footer>
						<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
						<Button type="submit" disabled={submitting || !discount || !ready || refund <= 0 || (method !== 'cash' && !referenceNo.trim())}>
							{submitting ? 'Recording…' : discount ? `Refund ${peso(refund)}` : 'Refund'}
						</Button>
					</Dialog.Footer>
				</form>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
