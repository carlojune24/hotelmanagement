<script lang="ts">
	import { page } from '$app/state';
	import TableShell from './table-shell.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
</script>

<!-- Keyed by the table's code: scanning another table's QR in the same tab starts a fresh cart, never carries one over. -->
{#key page.params.token}
	<TableShell {data}>
		{@render children()}
	</TableShell>
{/key}
