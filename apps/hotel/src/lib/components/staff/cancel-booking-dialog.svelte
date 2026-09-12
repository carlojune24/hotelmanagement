<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { CancellationQuote } from '$lib/server/cancellation';

	let {
		open = $bindable(false),
		quote,
		action,
		onDone
	}: {
		open?: boolean;
		quote: CancellationQuote | null;
		/** Form action, e.g. `?/cancel` (detail page) or `?/cancelBooking` (front desk / list). */
		action: string;
		onDone?: () => void;
	} = $props();

	const peso = (c: number) => `₱${(c / 100).toFixed(2)}`;

	const REFUND_METHODS = [
		{ v: 'cash', label: 'Cash' },
		{ v: 'gcash', label: 'GCash' },
		{ v: 'maya', label: 'Maya' },
		{ v: 'bank_transfer', label: 'Bank transfer' },
		{ v: 'card', label: 'Card' },
		{ v: 'paymongo', label: 'PayMongo (refund to original payment method)' }
	] as const;

	let fee = $state('0.00');
	let refundMethod = $state<(typeof REFUND_METHODS)[number]['v']>('cash');
	let reason = $state('');
	let submitting = $state(false);

	// Re-seed the editable fields each time a new quote opens the dialog.
	let lastQuoteId = $state<string | null>(null);
	$effect(() => {
		if (quote && quote.id !== lastQuoteId) {
			lastQuoteId = quote.id;
			fee = (quote.fee.feeCentavos / 100).toFixed(2);
			reason = '';
			refundMethod = 'cash';
		}
	});

	const paidCentavos = $derived(quote?.paidCentavos ?? 0);
	const paymongoRefundableCentavos = $derived(quote?.paymongoRefundableCentavos ?? 0);
	const feeCentavos = $derived(Math.max(0, Math.round(parseFloat(fee || '0') * 100)));
	const feeOverPaid = $derived(feeCentavos > paidCentavos);
	const refundCentavos = $derived(Math.max(0, paidCentavos - Math.min(feeCentavos, paidCentavos)));
	const paymongoOverLimit = $derived(
		refundMethod === 'paymongo' && refundCentavos > paymongoRefundableCentavos
	);
	const canSubmit = $derived(
		!submitting && reason.trim().length > 0 && !feeOverPaid && !paymongoOverLimit
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-md">
		{#if quote}
			<Dialog.Header>
				<Dialog.Title>Cancel {quote.kind === 'room' ? 'booking' : 'event'}</Dialog.Title>
				<Dialog.Description>
					{quote.guestName} · {quote.lineLabel}<br />
					<span class="text-xs">{quote.dateLabel}</span>
				</Dialog.Description>
			</Dialog.Header>

			<form
				method="POST"
				{action}
				use:enhance={() => {
					submitting = true;
					return async ({ update, result }) => {
						await update({ reset: false });
						submitting = false;
						if (result.type === 'success') {
							open = false;
							onDone?.();
						}
					};
				}}
				class="space-y-4"
			>
				<input type="hidden" name="kind" value={quote.kind} />
				<input type="hidden" name="id" value={quote.id} />

				{#if quote.orderStatus === 'confirmed'}
					<dl class="space-y-1.5 rounded-lg border border-border bg-surface-2 p-3 text-sm">
						<div class="flex items-center justify-between">
							<dt class="text-ink-muted">Paid to date</dt>
							<dd class="font-medium text-ink tabular-nums">{peso(quote.paidCentavos)}</dd>
						</div>
					</dl>
				{:else}
					<p class="rounded-lg border border-border bg-surface-2 p-3 text-sm text-ink-muted">
						This booking hasn't been paid — cancelling just releases the hold. No refund applies.
					</p>
				{/if}

				<div class="rounded-lg border border-border p-3">
					<p class="text-xs font-semibold tracking-wide text-ink-muted uppercase">Policy in effect</p>
					<p class="mt-1 text-sm text-ink">{quote.fee.policyLabel}</p>
					<p class="mt-0.5 text-xs text-ink-muted">{quote.fee.basisLabel}</p>
				</div>

				{#if quote.orderStatus === 'confirmed'}
					<div class="space-y-3">
						<div>
							<Label for="cancel-fee" class="text-xs">Cancellation fee (₱)</Label>
							<Input
								id="cancel-fee"
								name="fee"
								type="number"
								min="0"
								step="0.01"
								bind:value={fee}
								class="mt-1 tabular-nums"
								aria-invalid={feeOverPaid}
							/>
							<p class="mt-1 text-xs text-ink-muted">
								Suggested {peso(quote.fee.feeCentavos)} · editable — waive or adjust as needed.
							</p>
							{#if feeOverPaid}
								<p class="mt-1 text-xs text-danger">
									Can't exceed the {peso(quote.paidCentavos)} paid.
								</p>
							{/if}
						</div>

						<div class="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
							<span class="font-medium text-ink">Refund due</span>
							<span class="text-base font-semibold text-ink tabular-nums">{peso(refundCentavos)}</span>
						</div>

						{#if refundCentavos > 0}
							<div>
								<Label for="cancel-refund-method" class="text-xs">Refund via</Label>
								<select
									id="cancel-refund-method"
									name="refundMethod"
									bind:value={refundMethod}
									class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
								>
									{#each REFUND_METHODS as m (m.v)}
										<option value={m.v} disabled={m.v === 'paymongo' && paymongoRefundableCentavos <= 0}>
											{m.label}
										</option>
									{/each}
								</select>
								{#if refundMethod === 'paymongo'}
									<p class="mt-1 text-xs" class:text-danger={paymongoOverLimit}>
										{#if paymongoOverLimit}
											Only {peso(paymongoRefundableCentavos)} of this booking's payment was made via
											PayMongo — reduce the refund or pick another method for the rest.
										{:else}
											Actually refunds {peso(refundCentavos)} to the guest's card/e-wallet through PayMongo
											right now — not just a bookkeeping record.
										{/if}
									</p>
								{:else}
									<p class="mt-1 text-xs text-ink-muted">
										Records the payout here — hand the guest the money yourself (cash) or process the
										transfer on your end (GCash/Maya/bank/card).
									</p>
								{/if}
							</div>
						{/if}
					</div>
				{:else}
					<input type="hidden" name="refundMethod" value="cash" />
				{/if}

				<div>
					<Label for="cancel-reason" class="text-xs">Reason <span class="text-danger">*</span></Label>
					<textarea
						id="cancel-reason"
						name="reason"
						bind:value={reason}
						required
						rows="2"
						placeholder="Why is this booking being cancelled?"
						class="mt-1 w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm"
					></textarea>
				</div>

				<div class="flex justify-end gap-2 pt-1">
					<Button type="button" variant="ghost" onclick={() => (open = false)} disabled={submitting}>
						Keep booking
					</Button>
					<Button type="submit" variant="destructive" disabled={!canSubmit}>
						{submitting ? 'Cancelling…' : 'Cancel booking'}
					</Button>
				</div>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
