<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';

	/** A small, calm error page for the table-ordering app. No booking links: someone at a table needs "ask your waiter", not "Book now". */
	const notFound = $derived(page.status === 404);
	const title = $derived(notFound ? 'This table code is not working' : 'Something went wrong');
	const body = $derived(
		notFound
			? 'The code may have changed or the table is closed. Please ask your waiter and they will help you order.'
			: 'We could not load the menu just now. Please try again, or ask your waiter.'
	);
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<main class="tq-error">
	<div class="tq-error-rule" aria-hidden="true"></div>
	<p class="ledger-data tq-error-status">{page.status}</p>
	<h1 class="ledger-display tq-error-title">{title}</h1>
	<p class="tq-error-body">{body}</p>
	{#if !notFound}
		<button type="button" class="ledger-btn-primary tq-btn" onclick={() => invalidateAll()}>Try again</button>
	{/if}
</main>
