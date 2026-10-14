<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	// Printed documents are always black on white, whatever theme the app is in.
	$effect(() => {
		const root = document.documentElement;
		const wasDark = root.classList.contains('dark');
		root.classList.remove('dark');
		return () => {
			if (wasDark) root.classList.add('dark');
		};
	});
</script>

{@render children()}
