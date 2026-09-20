<script lang="ts">
	import { page } from '$app/state';
	import ErrorPanel from '$lib/components/staff/error-panel.svelte';
</script>

<svelte:head>
	<title>{page.status} — Platform admin</title>
</svelte:head>

<ErrorPanel
	status={page.status}
	message={page.error?.message}
	ref={page.error?.ref}
	homeHref="/admin"
	homeLabel="Back to admin"
/>
