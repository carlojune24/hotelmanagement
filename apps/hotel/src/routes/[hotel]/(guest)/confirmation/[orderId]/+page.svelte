<script lang="ts">
	import { invalidate } from '$app/navigation';
	import BedIcon from '@lucide/svelte/icons/bed';
	import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import MapPinIcon from '@lucide/svelte/icons/map-pin';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import MailIcon from '@lucide/svelte/icons/mail';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import { formatClockTime, formatStayDate, nightsLabel, stayNights } from '$lib/stay-dates';
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

	let copied = $state(false);
	async function copyCode() {
		try {
			await navigator.clipboard.writeText(data.order.confirmationCode);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard blocked (insecure context / permissions) — the code is still on screen to read.
		}
	}

	const itemCount = $derived(data.roomLines.length + data.hallLines.length);
	const hasRooms = $derived(data.roomLines.length > 0);
	const owesAtHotel = $derived(Boolean(data.payment && data.payment.dueAtHotelCentavos > 0));
	const contact = $derived(data.branding);
</script>

<svelte:head>
	<title>
		{data.status === 'confirmed' ? "You're booked" : 'Your booking'} — {data.hotel.name}
	</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	{#if data.status === 'confirmed'}
		<!-- Success: calm, specific, and it tells the guest the one thing to keep. -->
		<div class="flex items-start gap-3">
			<span
				class="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full"
				style="background: var(--hotel-accent); color: var(--ledger-paper);"
			>
				<CircleCheckIcon class="size-6" aria-hidden="true" />
			</span>
			<div>
				<h1 class="ledger-display text-2xl sm:text-3xl">You're booked, {data.guestName.split(' ')[0]}</h1>
				<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
					A confirmation is on its way to your email. Keep your confirmation code handy — it's all
					you need at check-in.
				</p>
			</div>
		</div>

		<div class="ledger-ticket-frame mt-8">
			<div class="ledger-ticket">
				<!-- The code is the hero: it's what the guest actually needs. -->
				<div class="flex flex-wrap items-end justify-between gap-3">
					<div>
						<div class="ledger-label flex items-center gap-1.5">
							<TicketIcon class="size-3.5" aria-hidden="true" /> Confirmation code
						</div>
						<div
							class="ledger-data mt-1 text-3xl font-semibold tracking-[0.12em] sm:text-4xl"
							aria-label="Confirmation code {data.order.confirmationCode.split('').join(' ')}"
						>
							{data.order.confirmationCode}
						</div>
					</div>
					<button
						type="button"
						onclick={copyCode}
						class="ledger-btn-ghost inline-flex min-h-11 items-center gap-1.5 text-sm"
					>
						{#if copied}<CheckIcon class="size-4" aria-hidden="true" /> Copied{:else}<CopyIcon
								class="size-4"
								aria-hidden="true"
							/> Copy code{/if}
					</button>
				</div>
				<span class="sr-only" role="status">{copied ? 'Confirmation code copied' : ''}</span>

				<div class="mt-5 border-t border-[var(--ledger-rule)] pt-4">
					<div class="ledger-display text-lg">{data.guestName}</div>
					<p class="text-sm text-[var(--ledger-ink-muted)]">
						{itemCount} item{itemCount === 1 ? '' : 's'} booked
					</p>
				</div>

				<ul class="mt-2 divide-y divide-[var(--ledger-rule)]">
					{#each data.roomLines as r (r.id)}
						<li class="flex gap-3 py-3">
							<BedIcon
								class="mt-0.5 size-5 shrink-0 text-[var(--ledger-ink-muted)]"
								aria-hidden="true"
							/>
							<div class="min-w-0">
								<div class="font-medium">
									{r.roomTypeName}{r.quantity > 1 ? ` × ${r.quantity}` : ''}
								</div>
								<div class="text-sm">
									<span class="ledger-data">{formatStayDate(r.checkIn)}</span>
									<span class="text-[var(--ledger-ink-muted)]" aria-hidden="true"> → </span>
									<span class="ledger-data">{formatStayDate(r.checkOut)}</span>
								</div>
								<div class="text-xs text-[var(--ledger-ink-muted)]">
									{nightsLabel(stayNights(r.checkIn, r.checkOut))}
								</div>
							</div>
						</li>
					{/each}
					{#each data.hallLines as h (h.id)}
						<li class="flex gap-3 py-3">
							<PartyPopperIcon
								class="mt-0.5 size-5 shrink-0 text-[var(--ledger-ink-muted)]"
								aria-hidden="true"
							/>
							<div class="min-w-0">
								<div class="font-medium">{h.hallName}</div>
								<div class="text-sm">
									<span class="ledger-data">{formatStayDate(h.eventDate)}</span>
									<span class="ledger-data text-[var(--ledger-ink-muted)]">
										· {h.startTime.slice(0, 5)}–{h.endTime.slice(0, 5)}</span
									>
								</div>
								<div class="text-xs text-[var(--ledger-ink-muted)]">{h.eventType}</div>
							</div>
						</li>
					{/each}
				</ul>

				<table class="mt-2 w-full border-t border-[var(--ledger-rule)] text-sm">
					<tbody>
						{#if data.promo}
							<tr>
								<td class="ledger-label pt-3 pb-1">Price before promo</td>
								<td class="ledger-data pt-3 pb-1 text-right"
									>{peso(data.order.totalCentavos + data.promo.discountCentavos)}</td
								>
							</tr>
							<tr>
								<td class="ledger-label py-1">
									Promo {data.promo.code}{data.promo.terms ? ' · ' + data.promo.terms : ''}
								</td>
								<td class="ledger-data py-1 text-right" style="color: var(--hotel-accent-deep)"
									>−{peso(data.promo.discountCentavos)}</td
								>
							</tr>
						{/if}
						{#if owesAtHotel && data.payment}
							<tr>
								<td class="ledger-label py-1 {data.promo ? '' : 'pt-3'}">Paid online</td>
								<td class="ledger-data py-1 text-right {data.promo ? '' : 'pt-3'}"
									>{peso(data.payment.paidCentavos)}</td
								>
							</tr>
							<tr>
								<td class="ledger-label py-1 font-semibold">Due at the hotel</td>
								<td class="ledger-data py-1 text-right text-base font-semibold"
									>{peso(data.payment.dueAtHotelCentavos)}</td
								>
							</tr>
						{:else}
							<tr>
								<td class="ledger-label py-1 {data.promo ? '' : 'pt-3'}">Total paid</td>
								<td class="ledger-data py-1 text-right text-base font-semibold {data.promo ? '' : 'pt-3'}"
									>{peso(data.order.totalCentavos)}</td
								>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>
		</div>

		<!-- What's next: the practical facts a guest looks for the day they arrive. -->
		<section class="mt-8" aria-labelledby="next-heading">
			<h2 id="next-heading" class="ledger-label border-b border-[var(--ledger-rule)] pb-2">
				What's next
			</h2>
			<ul class="mt-3 space-y-3 text-sm">
				{#if hasRooms}
					<li class="flex gap-3">
						<ClockIcon class="mt-0.5 size-5 shrink-0 text-[var(--ledger-ink-muted)]" aria-hidden="true" />
						<span>
							Check-in from
							<span class="ledger-data font-medium">{formatClockTime(data.stayInfo.checkInTime)}</span>
							· check-out by
							<span class="ledger-data font-medium">{formatClockTime(data.stayInfo.checkOutTime)}</span>.
						</span>
					</li>
				{/if}
				<li class="flex gap-3">
					<TicketIcon class="mt-0.5 size-5 shrink-0 text-[var(--ledger-ink-muted)]" aria-hidden="true" />
					<span>
						Show your confirmation code
						<span class="ledger-data font-medium">{data.order.confirmationCode}</span> and a valid ID at
						the front desk.
					</span>
				</li>
				{#if owesAtHotel && data.payment}
					<li class="flex gap-3">
						<CircleCheckIcon
							class="mt-0.5 size-5 shrink-0 text-[var(--ledger-ink-muted)]"
							aria-hidden="true"
						/>
						<span>
							Pay the remaining
							<span class="ledger-data font-medium">{peso(data.payment.dueAtHotelCentavos)}</span> when you
							arrive.
						</span>
					</li>
				{/if}
				{#if contact.contactAddress}
					<li class="flex gap-3">
						<MapPinIcon class="mt-0.5 size-5 shrink-0 text-[var(--ledger-ink-muted)]" aria-hidden="true" />
						<span>{contact.contactAddress}</span>
					</li>
				{/if}
				{#if contact.contactPhone}
					<li class="flex gap-3">
						<PhoneIcon class="mt-0.5 size-5 shrink-0 text-[var(--ledger-ink-muted)]" aria-hidden="true" />
						<a href="tel:{contact.contactPhone}" class="underline underline-offset-2"
							>{contact.contactPhone}</a
						>
					</li>
				{/if}
				{#if contact.contactEmail}
					<li class="flex gap-3">
						<MailIcon class="mt-0.5 size-5 shrink-0 text-[var(--ledger-ink-muted)]" aria-hidden="true" />
						<a href="mailto:{contact.contactEmail}" class="underline underline-offset-2"
							>{contact.contactEmail}</a
						>
					</li>
				{/if}
			</ul>
		</section>

		<div
			class="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--ledger-rule)] px-4 py-3"
		>
			<p class="text-sm text-[var(--ledger-ink-muted)]">Need to request a change or ask a question?</p>
			<a
				href="../manage/{data.order.id}?t={data.order.accessToken}"
				class="ledger-btn-ghost inline-flex min-h-11 items-center text-sm whitespace-nowrap"
				>Manage your booking</a
			>
		</div>

		{#each data.roomLines.filter((r) => r.status === 'checked_out') as r (r.id)}
			<div
				class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--ledger-rule)] px-4 py-3"
			>
				<p class="text-sm text-[var(--ledger-ink-muted)]">
					How was your stay in the {r.roomTypeName}?
				</p>
				<a
					href="../leave-review/{r.id}?t={data.order.accessToken}"
					class="ledger-btn-ghost inline-flex min-h-11 items-center text-sm whitespace-nowrap"
					>Leave a review</a
				>
			</div>
		{/each}
	{:else if data.status === 'pending_payment'}
		<h1 class="ledger-display text-2xl">Confirming your payment…</h1>
		<p class="mt-2 max-w-md text-sm text-[var(--ledger-ink-muted)]">
			PayMongo is finalizing your payment. This page updates on its own — it usually takes just a
			few seconds. You don't need to refresh or pay again.
		</p>
		<div
			class="mt-6 flex items-center gap-3 rounded-md border border-[var(--ledger-rule)] px-4 py-4 text-sm"
			role="status"
		>
			<span class="size-2.5 animate-pulse rounded-full" style="background: var(--hotel-accent);"
			></span>
			<span>
				Waiting for confirmation…
				<span class="text-[var(--ledger-ink-muted)]">
					(check {Math.min(pollCount + 1, MAX_POLLS)} of {MAX_POLLS})
				</span>
			</span>
		</div>
		{#if pollCount >= MAX_POLLS}
			<p class="mt-4 max-w-md text-sm text-[var(--ledger-ink-muted)]">
				This is taking longer than usual. If you were charged, your booking will still be
				confirmed and you'll get an email — or contact the hotel with this reference:
				<span class="ledger-data font-medium">{data.order.confirmationCode}</span>.
			</p>
		{/if}
		<p class="mt-6 max-w-md text-sm text-[var(--ledger-ink-muted)]">
			Closed the payment page before paying?
			<a
				href="../review/{data.order.id}?t={data.order.accessToken}"
				class="underline underline-offset-2">Continue to payment</a
			>
		</p>
	{:else}
		<h1 class="ledger-display text-2xl">This booking isn't confirmed</h1>
		<p class="mt-2 max-w-md text-sm text-[var(--ledger-ink-muted)]">
			Its current status is <span class="ledger-data">{data.status}</span>. If you believe this is a
			mistake, please contact the hotel directly.
		</p>
	{/if}
</div>
