<script lang="ts">
	import { page } from '$app/state';
	import ErrorPanel from '$lib/components/staff/error-panel.svelte';

	/** Renders inside the management shell, so the sidebar stays and staff keep their place. */
	const base = $derived(`/${page.params.hotel}/management`);
</script>

<svelte:head>
	<title>{page.status} — Management</title>
</svelte:head>

<ErrorPanel
	status={page.status}
	message={page.error?.message}
	ref={page.error?.ref}
	homeHref="{base}/dashboard"
	homeLabel="Back to dashboard"
/>
