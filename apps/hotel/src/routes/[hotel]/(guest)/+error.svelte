<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { errorCopy } from '$lib/error-copy';

	/** Woven Ledger error page. Renders inside the (guest) layout, so the hotel's accent, paper
	 *  and display font are already in scope. The one branded gesture is a single accent
	 *  hairline — no woven band, no illustration (an error isn't a hero moment). */
	const copy = $derived(errorCopy(page.status, page.error?.message));
	const hotelName = $derived(page.data.hotel?.name);
	const base = $derived(`/${page.params.hotel}`);
	const ref = $derived(page.error?.ref);
</script>

<svelte:head>
	<title>{page.status} — {hotelName ?? 'Booking'}</title>
</svelte:head>

<main class="mx-auto max-w-2xl px-4 py-20 sm:px-6 sm:py-28">
	<div class="h-px w-16" style="background: var(--hotel-accent)"></div>

	<p class="ledger-data mt-6 text-sm tabular-nums" style="color: var(--ledger-ink-muted)">
		{page.status}
	</p>
	<h1 class="ledger-display mt-2 text-3xl text-balance sm:text-4xl">{copy.title}</h1>
	<p class="mt-4 max-w-[65ch]" style="color: var(--ledger-ink-muted)">{copy.body}</p>

	{#if ref}
		<p class="ledger-hairline mt-8 pb-4 text-sm" style="color: var(--ledger-ink-muted)">
			Reference <span class="ledger-data select-all" style="color: var(--ledger-ink)">{ref}</span>
		</p>
	{/if}

	<div class="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
		<a href={base} class="ledger-btn-primary">
			{hotelName ? `Back to ${hotelName}` : 'Back to the hotel'}
		</a>
		<a href="{base}/dates" class="ledger-btn-ghost">Start a new search</a>
		{#if copy.retryable}
			<button type="button" class="ledger-btn-ghost" onclick={() => invalidateAll()}>
				Try again
			</button>
		{/if}
	</div>
</main>
