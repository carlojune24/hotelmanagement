<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import { REPORTS } from '$lib/reports';

	let { children }: { children: Snippet } = $props();
	const activeKey = $derived(REPORTS.find((r) => page.url.pathname.startsWith(`/reports/${r.key}`))?.key);
</script>

<svelte:head><title>Reports · HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div>
		<h1 class="text-5xl font-light tracking-tight">Reports</h1>
		<p class="mt-2 max-w-2xl text-sm text-ink-muted">Reports built from payslips and the other records HR keeps.</p>
	</div>

	<div class="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
		<nav class="flex flex-wrap gap-2 lg:flex-col lg:gap-1" aria-label="Reports">
			{#each REPORTS as r (r.key)}
				<a
					href="/reports/{r.key}"
					aria-current={activeKey === r.key ? 'page' : undefined}
					class="rounded-full px-4 py-2 text-sm font-medium transition-colors lg:rounded-2xl {activeKey === r.key
						? 'bg-primary text-primary-foreground'
						: 'bg-white/70 text-ink hover:bg-gold-soft'}"
				>
					{r.label}
				</a>
			{/each}
		</nav>
		<div class="min-w-0">{@render children()}</div>
	</div>
</div>
