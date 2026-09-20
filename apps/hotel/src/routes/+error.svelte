<script lang="ts">
	import { page } from '$app/state';
	import ErrorPanel from '$lib/components/staff/error-panel.svelte';

	/** Neutral fallback: unknown hotel slugs, auth pages, print routes, and any failure that
	 *  happens above a layout that could have supplied hotel branding or a shell. Deliberately
	 *  unbranded — nothing here knows which hotel (if any) the visitor was at. */
</script>

<svelte:head>
	<title>{page.status} — MM Hotel</title>
</svelte:head>

<ErrorPanel
	status={page.status}
	message={page.error?.message}
	ref={page.error?.ref}
	homeHref="/"
	homeLabel="Go home"
/>
