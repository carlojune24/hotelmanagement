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
	const partial = $derived(data.order.dueNowCentavos < data.order.totalCentavos);
	/** With a downpayment policy the guest picks: just the downpayment, or the whole bill now. */
	let payOption = $state<'partial' | 'full'>('partial');
	const chargeNow = $derived(
		partial && payOption === 'full' ? data.order.totalCentavos : data.order.dueNowCentavos
	);

	const itemCount = $derived(data.roomLines.length + data.hallLines.length);
</script>

<div class="mx-auto max-w-3xl">
	<a href="/{page.params.hotel}/details" class="storefront-step-back">
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
			released. Please <a class="underline" href="/{page.params.hotel}">start a new search</a>.
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
				{#each data.roomLines as r (r.id)}
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
				{#each data.hallLines as h (h.id)}
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
				{#if partial}
					<Table.Row>
						<Table.Cell class="font-semibold">Due now via PayMongo</Table.Cell>
						<Table.Cell class="ledger-data text-right font-semibold"
							>{peso(data.order.dueNowCentavos)}</Table.Cell
						>
					</Table.Row>
					<Table.Row>
						<Table.Cell class="text-[var(--ledger-ink-muted)]">Due at the hotel</Table.Cell>
						<Table.Cell class="ledger-data text-right text-[var(--ledger-ink-muted)]"
							>{peso(data.order.totalCentavos - data.order.dueNowCentavos)}</Table.Cell
						>
					</Table.Row>
				{/if}
			</Table.Body>
		</Table.Root>
	</div>

	{#if !data.expired}
		<p class="mt-4 text-xs text-[var(--ledger-ink-muted)]">
			You'll be redirected to PayMongo to complete payment securely, then brought back here.
			{#if partial && payOption === 'partial'}
				The remaining {peso(data.order.totalCentavos - data.order.dueNowCentavos)} is paid at the
				hotel.
			{/if}
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
			{#if partial}
				<fieldset class="mb-4 space-y-2">
					<legend class="ledger-label mb-1">How much would you like to pay now?</legend>
					<label class="ledger-hairline flex cursor-pointer items-baseline justify-between gap-4 py-2">
						<span class="flex items-baseline gap-2">
							<input type="radio" name="option" value="partial" bind:group={payOption} />
							<span>Downpayment — the rest at the hotel</span>
						</span>
						<span class="ledger-data">{peso(data.order.dueNowCentavos)}</span>
					</label>
					<label class="ledger-hairline flex cursor-pointer items-baseline justify-between gap-4 py-2">
						<span class="flex items-baseline gap-2">
							<input type="radio" name="option" value="full" bind:group={payOption} />
							<span>Pay in full — nothing left to pay at the hotel</span>
						</span>
						<span class="ledger-data">{peso(data.order.totalCentavos)}</span>
					</label>
				</fieldset>
			{/if}
			<Button type="submit" class="ledger-btn-primary" disabled={submitting}>
				{submitting ? 'Redirecting…' : `Pay ${peso(chargeNow)} ${partial && payOption === 'partial' ? 'now ' : ''}with PayMongo`}
			</Button>
		</form>
	{/if}
</div>
