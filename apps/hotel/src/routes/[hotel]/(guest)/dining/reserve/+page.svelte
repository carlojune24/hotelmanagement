<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import StorefrontFooter from '$lib/components/storefront/storefront-footer.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The shared guest layout guarantees a hotel (it 404s otherwise); its type is just nullable.
	const hotel = $derived(page.data.hotel!);

	const prettyTime = (hhmm: string) =>
		new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
			new Date(`1970-01-01T${hhmm}:00Z`)
		);
	const dateLabel = $derived(
		data.date
			? new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(
					new Date(`${data.date}T00:00:00Z`)
				)
			: ''
	);

	let findForm: HTMLFormElement | undefined = $state();
	const v = $derived(form?.values);
	const anyFree = $derived(data.slots?.some((s) => s.available) ?? false);
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Reserve a table — {hotel.name}</title>
</svelte:head>

<StorefrontNav
	hotelSlug={hotel.slug}
	hotelName={hotel.name}
	logoUrl={page.data.branding.logoUrl}
	showAmenities={page.data.hotelAmenities.length > 0}
	showFunctionHall={page.data.functionHalls.length > 0}
	showDining={true}
	showReviews={page.data.reviews.length > 0}
	accent={page.data.theme.accent}
	accentDeep={page.data.theme.accentDeep}
	paper={page.data.theme.paper}
	paperDeep={page.data.theme.paperDeep}
/>

<section class="storefront-section">
	<div class="mx-auto max-w-3xl">
		<a href="/{hotel.slug}/dining" class="storefront-step-back">← Back to dining</a>
		<h1 class="storefront-section-title ink-heading ledger-display mt-3 text-3xl sm:text-4xl">Reserve a table</h1>
		<p class="storefront-section-lede text-[0.9375rem] leading-relaxed">
			Choose a day and the size of your party, then pick a time. No payment is needed to hold a table.
		</p>

		<!-- When: a plain GET, so the page works without scripts and times are shareable -->
		<form
			bind:this={findForm}
			method="GET"
			data-sveltekit-keepfocus
			data-sveltekit-noscroll
			class="mt-8 space-y-5"
		>
			<fieldset class="space-y-5">
				<legend class="ledger-label w-full border-b border-[var(--ledger-rule)] pb-2">When</legend>

				{#if data.venues.length > 1}
					<div>
						<Label for="rvVenue" class="ledger-label">Where</Label>
						<select
							id="rvVenue"
							name="venue"
							class="ledger-field mt-1 w-full"
							onchange={() => findForm?.requestSubmit()}
						>
							{#each data.venues as venue (venue.id)}
								<option value={venue.id} selected={venue.id === data.venue.id}>{venue.title}</option>
							{/each}
						</select>
					</div>
				{:else}
					<input type="hidden" name="venue" value={data.venue.id} />
				{/if}

				<div class="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
					<div>
						<Label for="rvDate" class="ledger-label">Date</Label>
						<Input
							id="rvDate"
							name="date"
							type="date"
							min={data.today}
							max={data.maxDate}
							value={data.date ?? ''}
							required
							class="ledger-field mt-1"
							onchange={() => findForm?.requestSubmit()}
						/>
					</div>
					<div>
						<Label for="rvParty" class="ledger-label">Guests</Label>
						<Input
							id="rvParty"
							name="party"
							type="number"
							min="1"
							max={data.partyCap}
							value={data.party}
							required
							inputmode="numeric"
							class="ledger-field mt-1"
							onchange={() => findForm?.requestSubmit()}
						/>
					</div>
					<button type="submit" class="ledger-btn-primary min-h-11 px-5">Show times</button>
				</div>
				<p class="text-xs text-[var(--ledger-ink-muted)]">
					Online bookings are for up to {data.partyCap} guests. For a larger group, please call us.
				</p>
			</fieldset>
		</form>

		{#if data.date && data.slots}
			<form
				method="POST"
				action="?/reserve"
				class="mt-10 space-y-8"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: false });
						submitting = false;
					};
				}}
			>
				<input type="hidden" name="venue" value={data.venue.id} />
				<input type="hidden" name="date" value={data.date} />
				<input type="hidden" name="party" value={data.party} />
				<!-- honeypot: real visitors never see this -->
				<div class="absolute -left-[9999px]" aria-hidden="true">
					<label>Website <input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
				</div>

				<fieldset>
					<legend class="ledger-label w-full border-b border-[var(--ledger-rule)] pb-2">
						Choose a time <span class="normal-case tracking-normal">· {dateLabel}, {data.party} {data.party === 1 ? 'guest' : 'guests'}</span>
					</legend>
					{#if data.slots.length === 0}
						<p class="mt-4 text-sm text-[var(--ledger-ink-muted)]">
							There are no times on this date. Seatings run {data.hoursNote}; try another day.
						</p>
					{:else}
						<div class="dining-slot-grid mt-4" role="radiogroup" aria-label="Available times">
							{#each data.slots as s (s.time)}
								<label class="dining-slot">
									<input
										type="radio"
										name="time"
										value={s.time}
										disabled={!s.available}
										required
										checked={v?.time === s.time}
									/>
									<span class="ledger-data">{prettyTime(s.time)}</span>
								</label>
							{/each}
						</div>
						{#if !anyFree}
							<p class="mt-4 text-sm text-[var(--ledger-ink-muted)]">
								We are fully booked for {data.party} {data.party === 1 ? 'guest' : 'guests'} on this date. Try another day or a smaller party.
							</p>
						{/if}
					{/if}
				</fieldset>

				{#if anyFree}
					<fieldset class="space-y-5">
						<legend class="ledger-label w-full border-b border-[var(--ledger-rule)] pb-2">Your details</legend>
						<div>
							<Label for="rvName" class="ledger-label">Name</Label>
							<Input id="rvName" name="guestName" required autocomplete="name" value={v?.guestName ?? ''} class="ledger-field mt-1" />
						</div>
						<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
							<div>
								<Label for="rvPhone" class="ledger-label">Mobile number</Label>
								<Input id="rvPhone" name="guestPhone" type="tel" required autocomplete="tel" inputmode="tel" value={v?.guestPhone ?? ''} class="ledger-field mt-1" />
								<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">In case we need to reach you about your table.</p>
							</div>
							<div>
								<Label for="rvEmail" class="ledger-label">Email (optional)</Label>
								<Input id="rvEmail" name="guestEmail" type="email" autocomplete="email" inputmode="email" value={v?.guestEmail ?? ''} class="ledger-field mt-1" />
								<p class="mt-1 text-xs text-[var(--ledger-ink-muted)]">We send your reservation code here.</p>
							</div>
						</div>
						<div>
							<Label for="rvRemarks" class="ledger-label">Anything we should know (optional)</Label>
							<Textarea id="rvRemarks" name="remarks" rows={2} maxlength={500} placeholder="Allergies, a celebration, a high chair…" value={v?.remarks ?? ''} class="ledger-field mt-1" />
						</div>
					</fieldset>

					{#if form?.error}
						<p role="alert" class="border-t border-[var(--ledger-danger)] pt-3 text-sm text-[var(--ledger-danger)]">{form.error}</p>
					{/if}

					<div class="flex flex-wrap items-center gap-4">
						<button type="submit" class="ledger-btn-primary min-h-12 w-full sm:w-auto" disabled={submitting}>
							{submitting ? 'Reserving…' : 'Reserve my table'}
						</button>
						<p class="flex items-center gap-1.5 text-xs text-[var(--ledger-ink-muted)]">
							<ClockIcon class="size-3.5" aria-hidden="true" /> No payment needed. Please arrive on time.
						</p>
					</div>
				{/if}
			</form>
		{/if}
	</div>
</section>

<StorefrontFooter
	hotelSlug={hotel.slug}
	hotelName={hotel.name}
	city={hotel.city}
	showAmenities={page.data.hotelAmenities.length > 0}
	showFunctionHall={page.data.functionHalls.length > 0}
	showDining={true}
	showReviews={page.data.reviews.length > 0}
	facebookUrl={page.data.branding.facebookUrl}
	instagramUrl={page.data.branding.instagramUrl}
	tiktokUrl={page.data.branding.tiktokUrl}
/>
