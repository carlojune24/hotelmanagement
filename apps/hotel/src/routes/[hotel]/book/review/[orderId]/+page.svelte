<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	let submitting = $state(false);

	const itemCount = $derived(data.roomLines.length + data.hallLines.length);
</script>

<div class="mx-auto max-w-3xl">
	<a href="/{page.params.hotel}/book/details" class="storefront-step-back">
		← Back to guest information
	</a>
	<h1 class="mt-2 ledger-display text-2xl">Review your invoice</h1>
	<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
		{itemCount} item{itemCount === 1 ? '' : 's'} · {data.guest.fullName}
	</p>

	{#if data.expired}
		<p
			class="mt-4 rounded-md border border-[var(--ledger-rule)] bg-[var(--ledger-paper-2)] px-4 py-3 text-sm"
		>
			This booking has expired — payment wasn't completed in time and the rooms have been
			released. Please <a class="underline" href="/{page.params.hotel}/book">start a new search</a>.
		</p>
	{:else if data.cancelled}
		<p
			class="mt-4 rounded-md border border-[var(--ledger-rule)] bg-[var(--ledger-paper-2)] px-4 py-3 text-sm"
		>
			Payment was cancelled. Your order is still held — you can try paying again below.
		</p>
	{/if}

	<div class="mt-8">
		<Table.Root>
			<Table.Body>
				{#each data.roomLines as r (r.roomTypeName + r.checkIn)}
					<Table.Row>
						<Table.Cell>
							<div class="text-[var(--ledger-ink)]">
								{r.roomTypeName} — {r.ratePlanName}{r.quantity > 1 ? ` × ${r.quantity}` : ''}
							</div>
							<div class="ledger-data text-xs text-[var(--ledger-ink-muted)]">
								{r.checkIn} → {r.checkOut} · {r.quantity} room{r.quantity === 1 ? '' : 's'} · {r.occupancy}
								guest{r.occupancy === 1 ? '' : 's'} per room
							</div>
						</Table.Cell>
						<Table.Cell class="ledger-data text-right align-top"
							>{peso(r.subtotalCentavos)}</Table.Cell
						>
					</Table.Row>
				{/each}
				{#each data.hallLines as h (h.hallName + h.eventDate)}
					<Table.Row>
						<Table.Cell>
							<div class="text-[var(--ledger-ink)]">{h.hallName}</div>
							<div class="ledger-data text-xs text-[var(--ledger-ink-muted)]">
								{h.eventType} · {h.eventDate}, {h.startTime.slice(0, 5)}–{h.endTime.slice(
									0,
									5
								)} · {h.guestCount} guest{h.guestCount === 1 ? '' : 's'}
							</div>
						</Table.Cell>
						<Table.Cell class="ledger-data text-right align-top"
							>{peso(h.subtotalCentavos)}</Table.Cell
						>
					</Table.Row>
				{/each}
				<Table.Row>
					<Table.Cell class="text-[var(--ledger-ink-muted)]">Subtotal</Table.Cell>
					<Table.Cell class="ledger-data text-right"
						>{peso(data.order.subtotalCentavos)}</Table.Cell
					>
				</Table.Row>
				{#if data.order.feesCentavos > 0}
					<Table.Row>
						<Table.Cell class="text-[var(--ledger-ink-muted)]">Fees</Table.Cell>
						<Table.Cell class="ledger-data text-right">{peso(data.order.feesCentavos)}</Table.Cell
						>
					</Table.Row>
				{/if}
				<Table.Row>
					<Table.Cell class="text-[var(--ledger-ink-muted)]">VAT</Table.Cell>
					<Table.Cell class="ledger-data text-right">{peso(data.order.vatCentavos)}</Table.Cell>
				</Table.Row>
				<Table.Row>
					<Table.Cell class="text-base font-semibold">Total</Table.Cell>
					<Table.Cell class="ledger-data text-right text-lg font-semibold"
						>{peso(data.order.totalCentavos)}</Table.Cell
					>
				</Table.Row>
			</Table.Body>
		</Table.Root>
	</div>

	{#if !data.expired}
		<p class="mt-4 text-xs text-[var(--ledger-ink-muted)]">
			You'll be redirected to PayMongo to complete payment securely, then brought back here.
		</p>

		{#if form?.error}
			<p class="mt-4 text-sm" style="color: var(--ledger-danger, #b91c1c);">{form.error}</p>
		{/if}

		<form
			method="POST"
			action="?/pay&t={page.url.searchParams.get('t')}"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			class="mt-6"
		>
			<Button type="submit" class="ledger-btn-primary" disabled={submitting}>
				{submitting ? 'Redirecting…' : `Pay ${peso(data.order.totalCentavos)} with PayMongo`}
			</Button>
		</form>
	{/if}
</div>
