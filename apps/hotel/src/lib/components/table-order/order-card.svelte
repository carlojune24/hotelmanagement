<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import ProgressStrip from './progress-strip.svelte';
	import StatusPill from './status-pill.svelte';
	import { peso, statusLabel, statusTone, type TableOrder } from '$lib/dining-qr-ui';

	let { order, time }: { order: TableOrder; time: string } = $props();

	// Cancelling is a two-step inline confirm, never a pop-up: one slip of a thumb should not cancel dinner.
	let confirming = $state(false);
	const cancelled = $derived(order.status === 'cancelled');
</script>

<li class="tq-order tone-{statusTone(order.status)}" class:is-cancelled={cancelled}>
	<div class="tq-order-head">
		<p class="tq-order-code">
			<span class="ledger-data">{order.code}</span>
			<span class="tq-order-time">{time}</span>
		</p>
		<span class="tq-order-total">{peso(order.totalCentavos)}</span>
	</div>

	<StatusPill status={order.status} />
	<p class="tq-order-status">{statusLabel(order.status)}</p>
	{#if cancelled && order.cancelReason}<p class="tq-order-reason">{order.cancelReason}</p>{/if}

	<ProgressStrip status={order.status} />

	<ul class="tq-order-items">
		{#each order.items as i, idx (idx)}
			<li><span class="ledger-data">{i.quantity}×</span> {i.name}{i.addons.length ? ` (${i.addons.join(', ')})` : ''}</li>
		{/each}
	</ul>

	{#if order.status === 'pending_acceptance'}
		{#if !confirming}
			<button type="button" class="tq-link" onclick={() => (confirming = true)}>Cancel this order</button>
		{:else}
			<form
				method="POST"
				action="?/cancel"
				class="tq-confirm"
				use:enhance={() => async ({ update }) => {
					await update({ reset: false });
					confirming = false;
					await invalidate('app:dining-qr');
				}}
			>
				<input type="hidden" name="code" value={order.code} />
				<p>Cancel {order.code}? The restaurant has not started it yet.</p>
				<div class="tq-confirm-actions">
					<button type="submit" class="tq-btn tq-btn-danger">Yes, cancel it</button>
					<button type="button" class="tq-btn tq-btn-quiet" onclick={() => (confirming = false)}>Keep my order</button>
				</div>
			</form>
		{/if}
	{/if}
</li>
