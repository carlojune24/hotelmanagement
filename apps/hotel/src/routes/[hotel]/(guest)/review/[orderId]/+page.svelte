<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import BedIcon from '@lucide/svelte/icons/bed';
	import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
	import LockIcon from '@lucide/svelte/icons/lock';
	import { formatStayDate, nightsLabel, stayNights } from '$lib/stay-dates';
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
	const dueAtHotel = $derived(data.order.totalCentavos - chargeNow);

	const itemCount = $derived(data.roomLines.length + data.hallLines.length);
</script>

<svelte:head>
	<title>Review & pay — Book your stay</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<a href="/{page.params.hotel}/details" class="storefront-step-back">
		← Back to guest information
	</a>
	<h1 class="mt-2 ledger-display text-2xl">Review your booking</h1>
	<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
		{itemCount} item{itemCount === 1 ? '' : 's'} · booked for
		<span class="font-medium text-[var(--ledger-ink)]">{data.guest.fullName}</span>
		· {data.guest.email}
	</p>

	{#if data.expired}
		<p
			class="mt-4 rounded-md border border-[var(--ledger-rule)] bg-[var(--ledger-paper-2)] px-4 py-3 text-sm"
			role="alert"
		>
			This booking has expired — payment wasn't completed in time and the rooms have been
			released. Please <a class="underline" href="/{page.params.hotel}">start a new search</a>.
		</p>
	{:else if data.cancelled}
		<p
			class="mt-4 rounded-md border border-[var(--ledger-rule)] bg-[var(--ledger-paper-2)] px-4 py-3 text-sm"
			role="status"
		>
			Payment was cancelled. Your order is still held — you can try paying again below.
		</p>
	{/if}

	<!-- Your stay: what is being booked, in plain words. -->
	<section class="mt-8" aria-labelledby="stay-heading">
		<h2 id="stay-heading" class="ledger-label border-b border-[var(--ledger-rule)] pb-2">
			Your stay
		</h2>
		<ul class="divide-y divide-[var(--ledger-rule)]">
			{#each data.roomLines as r (r.id)}
				{@const nights = stayNights(r.checkIn, r.checkOut)}
				<li class="flex gap-3 py-4">
					<BedIcon class="mt-1 size-5 shrink-0 text-[var(--ledger-ink-muted)]" aria-hidden="true" />
					<div class="min-w-0 flex-1">
						<div class="ledger-display text-lg">
							{r.roomTypeName}{r.quantity > 1 ? ` × ${r.quantity}` : ''}
						</div>
						<div class="text-sm text-[var(--ledger-ink-muted)]">{r.ratePlanName}</div>
						<div class="mt-1 text-sm">
							<span class="ledger-data">{formatStayDate(r.checkIn)}</span>
							<span class="text-[var(--ledger-ink-muted)]" aria-hidden="true"> → </span>
							<span class="ledger-data">{formatStayDate(r.checkOut)}</span>
						</div>
						<div class="text-xs text-[var(--ledger-ink-muted)]">
							{nightsLabel(nights)} · {r.occupancy} guest{r.occupancy === 1 ? '' : 's'} per room
						</div>
					</div>
					<div class="ledger-data text-right">
						{peso(r.subtotalCentavos + (r.discountCentavos ?? 0))}
					</div>
				</li>
			{/each}
			{#each data.hallLines as h (h.id)}
				<li class="flex gap-3 py-4">
					<PartyPopperIcon
						class="mt-1 size-5 shrink-0 text-[var(--ledger-ink-muted)]"
						aria-hidden="true"
					/>
					<div class="min-w-0 flex-1">
						<div class="ledger-display text-lg">{h.hallName}</div>
						<div class="text-sm text-[var(--ledger-ink-muted)]">{h.eventType}</div>
						<div class="mt-1 text-sm">
							<span class="ledger-data">{formatStayDate(h.eventDate)}</span>
							<span class="ledger-data text-[var(--ledger-ink-muted)]">
								· {h.startTime.slice(0, 5)}–{h.endTime.slice(0, 5)}</span
							>
						</div>
						<div class="text-xs text-[var(--ledger-ink-muted)]">
							{h.guestCount} guest{h.guestCount === 1 ? '' : 's'}
						</div>
					</div>
					<div class="ledger-data text-right">{peso(h.subtotalCentavos)}</div>
				</li>
			{/each}
		</ul>
	</section>

	<!-- The bill: every peso accounted for, ending at exactly what is charged. -->
	<section class="mt-6" aria-labelledby="bill-heading">
		<h2 id="bill-heading" class="ledger-label border-b border-[var(--ledger-rule)] pb-2">
			Your bill
		</h2>
		<Table.Root>
			<Table.Body>
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
				{#if data.order.discountCentavos}
					<Table.Row>
						<Table.Cell class="text-[var(--ledger-ink-muted)]">
							Promo discount{#if data.promo}
								<span class="ledger-data ml-1 text-xs"
									>({data.promo.code}{data.promo.terms ? ' · ' + data.promo.terms : ''})</span
								>{/if}
						</Table.Cell>
						<Table.Cell class="ledger-data text-right" style="color: var(--hotel-accent-deep)"
							>−{peso(data.order.discountCentavos)}</Table.Cell
						>
					</Table.Row>
				{/if}
				<Table.Row>
					<Table.Cell class="text-base font-semibold">Total</Table.Cell>
					<Table.Cell class="ledger-data text-right text-lg font-semibold"
						>{peso(data.order.totalCentavos)}</Table.Cell
					>
				</Table.Row>
			</Table.Body>
		</Table.Root>
		{#if data.order.discountCentavos}
			<p class="mt-2 text-sm font-medium" style="color: var(--hotel-accent-deep)">
				You're saving {peso(data.order.discountCentavos)} with your promo code.
			</p>
		{/if}
	</section>

	{#if !data.expired}
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
			class="mt-8"
		>
			{#if partial}
				<fieldset class="space-y-3">
					<legend class="ledger-label mb-2 border-b border-[var(--ledger-rule)] pb-2 w-full">
						How much would you like to pay now?
					</legend>
					<label
						class="flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors"
						style="border-color: {payOption === 'partial' ? 'var(--hotel-accent)' : 'var(--ledger-rule)'};
							background: {payOption === 'partial' ? 'var(--ledger-paper-2)' : 'transparent'};"
					>
						<input
							type="radio"
							name="option"
							value="partial"
							bind:group={payOption}
							class="mt-1 size-4 accent-[var(--hotel-accent)]"
						/>
						<span class="flex-1">
							<span class="block font-medium">Pay a downpayment</span>
							<span class="block text-xs text-[var(--ledger-ink-muted)]">
								{peso(data.order.totalCentavos - data.order.dueNowCentavos)} is paid at the hotel.
							</span>
						</span>
						<span class="ledger-data font-semibold">{peso(data.order.dueNowCentavos)}</span>
					</label>
					<label
						class="flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors"
						style="border-color: {payOption === 'full' ? 'var(--hotel-accent)' : 'var(--ledger-rule)'};
							background: {payOption === 'full' ? 'var(--ledger-paper-2)' : 'transparent'};"
					>
						<input
							type="radio"
							name="option"
							value="full"
							bind:group={payOption}
							class="mt-1 size-4 accent-[var(--hotel-accent)]"
						/>
						<span class="flex-1">
							<span class="block font-medium">Pay in full</span>
							<span class="block text-xs text-[var(--ledger-ink-muted)]">
								Nothing left to pay at the hotel.
							</span>
						</span>
						<span class="ledger-data font-semibold">{peso(data.order.totalCentavos)}</span>
					</label>
				</fieldset>
			{/if}

			<!-- What happens next, so paying never feels like a leap. -->
			<ol class="mt-6 grid gap-3 text-sm sm:grid-cols-3">
				{#each [{ n: 1, t: 'Pay securely', d: 'You’re sent to PayMongo to complete payment.' }, { n: 2, t: 'Get confirmed', d: 'We email your confirmation and receipt right away.' }, { n: 3, t: 'Arrive & enjoy', d: partial && payOption === 'partial' ? `Pay the remaining ${peso(dueAtHotel)} at the hotel.` : 'Just bring your confirmation code.' }] as step (step.n)}
					<li class="flex gap-3 rounded-md border border-[var(--ledger-rule)] px-3 py-3">
						<span
							class="ledger-data flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
							style="background: var(--hotel-accent); color: var(--ledger-paper);">{step.n}</span
						>
						<span>
							<span class="block font-medium">{step.t}</span>
							<span class="block text-xs text-[var(--ledger-ink-muted)]">{step.d}</span>
						</span>
					</li>
				{/each}
			</ol>

			{#if form?.error}
				<p
					class="mt-4 rounded-md border px-4 py-3 text-sm"
					style="color: var(--ledger-danger, #b91c1c); border-color: var(--ledger-danger, #b91c1c);"
					role="alert"
				>
					{form.error}
				</p>
			{/if}

			<div class="mt-6 space-y-3">
				<Button
					type="submit"
					class="ledger-btn-primary min-h-12 w-full sm:w-auto"
					disabled={submitting}
				>
					{submitting
						? 'Redirecting…'
						: `Pay ${peso(chargeNow)} ${partial && payOption === 'partial' ? 'now ' : ''}with PayMongo`}
				</Button>
				<p class="flex items-center gap-1.5 text-xs text-[var(--ledger-ink-muted)]">
					<LockIcon class="size-3.5" aria-hidden="true" />
					Payment is handled securely by PayMongo — the hotel never sees your card details.
				</p>
			</div>
		</form>
	{/if}
</div>
