<script lang="ts">
	import { page } from '$app/state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const base = $derived(`/${page.params.hotel}/finance/reports`);
	const kindHint: Record<string, string> = { day: 'single day', range: 'date range', asOf: 'as of a date' };
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<h1 class="mb-4 text-xl font-semibold tracking-tight text-ink">Reports</h1>
	<div class="grid gap-3 sm:grid-cols-2">
		{#each data.reports as r (r.slug)}
			<a href="{base}/{r.slug}" class="rounded-xl border border-border p-4 hover:bg-surface-2">
				<div class="font-medium text-ink">{r.name}</div>
				<div class="text-xs text-ink-muted">{kindHint[r.kind]}</div>
			</a>
		{/each}
	</div>
</div>
