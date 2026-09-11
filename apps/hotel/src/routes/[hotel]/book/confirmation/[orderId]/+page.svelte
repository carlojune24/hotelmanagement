<script lang="ts">
	import { invalidate } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	const MAX_POLLS = 12;
	let pollCount = $state(0);

	$effect(() => {
		if (data.status !== 'pending_payment' || pollCount >= MAX_POLLS) return;
		const timer = setTimeout(() => {
			pollCount += 1;
			invalidate('app:booking-status');
		}, 3000);
		return () => clearTimeout(timer);
	});
</script>

<div class="mx-auto max-w-2xl">
	{#if data.status === 'confirmed'}
		<h1 class="ledger-display text-2xl">You're booked</h1>
		<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
			A confirmation has been sent — keep this page or a screenshot for your records.
		</p>

		<div class="ledger-ticket-frame mt-8">
			<div class="ledger-ticket">
				<div class="ledger-display text-xl">{data.guestName}</div>
				<p class="text-sm text-[var(--ledger-ink-muted)]">
					{data.roomLines.length + data.hallLines.length} item{data.roomLines.length +
						data.hallLines.length ===
					1
						? ''
						: 's'}
				</p>

				<table class="mt-5 w-full text-sm">
					<tbody>
						{#each data.roomLines as r (r.roomTypeName + r.checkIn)}
							<tr class="ledger-hairline">
								<td class="ledger-label py-2"
									>{r.roomTypeName}{r.quantity > 1 ? ` × ${r.quantity}` : ''}</td
								>
								<td class="ledger-data py-2 text-right">{r.checkIn} → {r.checkOut}</td>
							</tr>
						{/each}
						{#each data.hallLines as h (h.hallName + h.eventDate)}
							<tr class="ledger-hairline">
								<td class="ledger-label py-2">{h.hallName}</td>
								<td class="ledger-data py-2 text-right"
									>{h.eventDate}, {h.startTime.slice(0, 5)}–{h.endTime.slice(0, 5)}</td
								>
							</tr>
						{/each}
						<tr class="ledger-hairline">
							<td class="ledger-label py-2">Total paid</td>
							<td class="ledger-data py-2 text-right">{peso(data.order.totalCentavos)}</td>
						</tr>
						<tr>
							<td class="ledger-label py-2">Confirmation code</td>
							<td class="ledger-data py-2 text-right text-base font-semibold"
								>{data.order.confirmationCode}</td
							>
						</tr>
					</tbody>
				</table>
			</div>
		</div>

		<div class="mt-6 flex items-center justify-between gap-4 rounded-md border border-[var(--ledger-rule)] px-4 py-3">
			<p class="text-sm text-[var(--ledger-ink-muted)]">Need to request a change or ask a question?</p>
			<a
				href="../manage/{data.order.id}?t={data.order.accessToken}"
				class="ledger-btn-ghost text-sm whitespace-nowrap">Manage your booking</a
			>
		</div>

		{#each data.roomLines.filter((r) => r.status === 'checked_out') as r (r.id)}
			<div class="mt-6 flex items-center justify-between gap-4 rounded-md border border-[var(--ledger-rule)] px-4 py-3">
				<p class="text-sm text-[var(--ledger-ink-muted)]">
					How was your stay in the {r.roomTypeName}?
				</p>
				<a
					href="../leave-review/{r.id}?t={data.order.accessToken}"
					class="ledger-btn-ghost text-sm whitespace-nowrap">Leave a review</a
				>
			</div>
		{/each}
	{:else if data.status === 'pending_payment'}
		<h1 class="ledger-display text-2xl">Confirming your payment…</h1>
		<p class="mt-2 max-w-md text-sm text-[var(--ledger-ink-muted)]">
			PayMongo is finalizing your payment. This page will update automatically — it usually takes
			just a few seconds.
		</p>
		<div class="mt-6 flex items-center gap-2 text-sm text-[var(--ledger-ink-muted)]">
			<span class="size-2 animate-pulse rounded-full" style="background: var(--hotel-accent);"
			></span>
			Waiting for confirmation…
		</div>
	{:else}
		<h1 class="ledger-display text-2xl">This booking isn't confirmed</h1>
		<p class="mt-2 max-w-md text-sm text-[var(--ledger-ink-muted)]">
			Its current status is <span class="ledger-data">{data.status}</span>. If you believe this is a
			mistake, please contact the hotel directly.
		</p>
	{/if}
</div>
