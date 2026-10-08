<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import StorefrontNav from '$lib/components/storefront/storefront-nav.svelte';
	import StorefrontFooter from '$lib/components/storefront/storefront-footer.svelte';
		import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import TicketIcon from '@lucide/svelte/icons/ticket';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CalendarPlusIcon from '@lucide/svelte/icons/calendar-plus';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The shared guest layout guarantees a hotel (it 404s otherwise); its type is just nullable.
	const hotel = $derived(page.data.hotel!);
	const r = $derived(data.reservation);
	const done = $derived(['completed', 'cancelled', 'no_show'].includes(r.status));

	const HEADLINE: Record<string, { title: string; note: string }> = {
		confirmed: { title: 'Your table is reserved', note: 'No payment is needed. Please arrive on time, and call us if you are running late.' },
		pending: { title: 'We have your request', note: 'The restaurant will confirm shortly. This page updates on its own.' },
		seated: { title: 'Welcome. Enjoy your meal', note: 'You are seated. We hope you have a wonderful time.' },
		completed: { title: 'Thank you for dining with us', note: 'We hope to see you again soon.' },
		no_show: { title: 'This reservation was closed', note: 'It was marked as not attended. Please call us if that is a mistake.' },
		cancelled: { title: 'Reservation cancelled', note: 'Your table has been released. You are welcome to book again any time.' }
	};
	const head = $derived(HEADLINE[r.status] ?? HEADLINE.confirmed!);

	const dateLabel = $derived(
		new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
			new Date(`${r.local.date}T00:00:00Z`)
		)
	);
	const timeLabel = $derived(
		new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
			new Date(`1970-01-01T${r.local.time}:00Z`)
		)
	);

	// Keep the page current while the reservation is still live (staff seating the party, etc.).
	$effect(() => {
		if (done) return;
		const timer = setInterval(() => invalidate('app:dining-reservation'), 20_000);
		return () => clearInterval(timer);
	});

	let copied = $state(false);
	async function copyCode() {
		try {
			await navigator.clipboard.writeText(r.code);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard blocked: the code is still on screen to read.
		}
	}

	let confirmOpen = $state(false);
	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.cancelled) {
			toast.success('Your reservation was cancelled.');
			confirmOpen = false;
		}
	});

	const calendarUrl = $derived(`/${page.params.hotel}/dining/reserve/${r.code}/calendar?t=${data.token}`);
	const contactPhone = $derived(page.data.branding?.contactPhone ?? null);
</script>

<svelte:head>
	<title>{head.title} — {hotel.name}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="no-print">
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
</div>

<section class="storefront-section">
	<div class="mx-auto max-w-2xl">
		<div class="flex items-start gap-3">
			<span
				class="mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full"
				style="background: {r.status === 'cancelled' || r.status === 'no_show' ? 'var(--ledger-paper-2)' : 'var(--hotel-accent-light)'}; color: {r.status === 'cancelled' || r.status === 'no_show' ? 'var(--ledger-ink-muted)' : 'var(--hotel-accent-deep)'};"
			>
				{#if r.status === 'cancelled' || r.status === 'no_show'}
					<CircleXIcon class="size-5" aria-hidden="true" />
				{:else}
					<CircleCheckIcon class="size-5" aria-hidden="true" />
				{/if}
			</span>
			<div>
				<h1 class="ledger-display text-2xl sm:text-3xl" aria-live="polite">{head.title}</h1>
				<p class="mt-1 text-[0.9375rem] text-[var(--ledger-ink-muted)]">{head.note}</p>
			</div>
		</div>

		<div class="ledger-ticket-frame mt-8">
			<div class="ledger-ticket">
				<div class="flex flex-wrap items-end justify-between gap-3">
					<div>
						<div class="ledger-label flex items-center gap-1.5">
							<TicketIcon class="size-3.5" aria-hidden="true" /> Reservation code
						</div>
						<div
							class="ledger-data mt-1 text-3xl font-semibold tracking-[0.12em] sm:text-4xl"
							aria-label="Reservation code {r.code.split('').join(' ')}"
						>
							{r.code}
						</div>
					</div>
					<button type="button" onclick={copyCode} class="ledger-btn-ghost no-print inline-flex min-h-11 items-center gap-1.5 text-sm">
						{#if copied}<CheckIcon class="size-4" aria-hidden="true" /> Copied{:else}<CopyIcon class="size-4" aria-hidden="true" /> Copy code{/if}
					</button>
				</div>

				<div class="mt-5 border-t border-[var(--ledger-rule)] pt-4">
					<div class="ledger-display text-lg">{r.guestName}</div>
					<p class="text-sm text-[var(--ledger-ink-muted)]">{r.venueTitle}</p>
				</div>

				<dl class="mt-2 divide-y divide-[var(--ledger-rule)]">
					<div class="flex items-baseline justify-between gap-4 py-3">
						<dt class="ledger-label">Date</dt>
						<dd class="ledger-data text-right">{dateLabel}</dd>
					</div>
					<div class="flex items-baseline justify-between gap-4 py-3">
						<dt class="ledger-label">Time</dt>
						<dd class="ledger-data text-right">{timeLabel}</dd>
					</div>
					<div class="flex items-baseline justify-between gap-4 py-3">
						<dt class="ledger-label">Party</dt>
						<dd class="ledger-data text-right">{r.partySize}</dd>
					</div>
					{#if r.remarks}
						<div class="flex items-baseline justify-between gap-4 py-3">
							<dt class="ledger-label">Note</dt>
							<dd class="max-w-[60%] text-right text-sm">{r.remarks}</dd>
						</div>
					{/if}
				</dl>
			</div>
		</div>

		<div class="no-print mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
			{#if r.status !== 'cancelled' && r.status !== 'no_show'}
				<a href={calendarUrl} class="ledger-btn-ghost inline-flex min-h-11 items-center gap-1.5 text-sm">
					<CalendarPlusIcon class="size-4" aria-hidden="true" /> Add to calendar
				</a>
			{/if}
			<button type="button" onclick={() => window.print()} class="ledger-btn-ghost inline-flex min-h-11 items-center gap-1.5 text-sm">
				<PrinterIcon class="size-4" aria-hidden="true" /> Print
			</button>
			{#if data.canCancel}
				<button type="button" onclick={() => (confirmOpen = true)} class="ledger-btn-ghost inline-flex min-h-11 items-center text-sm">
					Cancel reservation
				</button>
			{/if}
			{#if contactPhone}
				<a href="tel:{contactPhone}" class="ledger-btn-ghost inline-flex min-h-11 items-center gap-1.5 text-sm">
					<PhoneIcon class="size-4" aria-hidden="true" /> {contactPhone}
				</a>
			{/if}
		</div>

		{#if confirmOpen}
			<div class="no-print mt-4 border-t border-[var(--ledger-rule)] pt-5" role="alertdialog" aria-labelledby="cancelTitle">
				<p id="cancelTitle" class="ledger-display text-lg">Cancel this reservation?</p>
				<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
					Your table at {r.venueTitle} on {dateLabel} at {timeLabel} will be released. You can book again any time.
				</p>
				<div class="mt-4 flex flex-wrap items-center gap-3">
					<button type="button" onclick={() => (confirmOpen = false)} class="ledger-btn-primary min-h-11 px-5">Keep my table</button>
					<form method="POST" action="?/cancel&t={data.token}" use:enhance>
						<button type="submit" class="ledger-btn-ghost inline-flex min-h-11 items-center text-sm">Yes, cancel it</button>
					</form>
				</div>
			</div>
		{/if}

		<p class="no-print mt-8 text-sm">
			<a href="/{page.params.hotel}/dining" class="underline underline-offset-4">Back to dining</a>
		</p>
	</div>
</section>

<div class="no-print">
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
</div>
