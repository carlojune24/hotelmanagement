<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const base = $derived(`/${page.params.hotel}/management/kitchen`);

	// Board is the index route, so it matches the bare path and nothing else.
	const tabs = [
		{ seg: '', label: 'Board' },
		{ seg: 'prep', label: 'Prep' },
		{ seg: 'sold-out', label: 'Sold out' },
		{ seg: 'history', label: 'History' },
		{ seg: 'stations', label: 'Stations' }
	];

	const isActive = (seg: string) => {
		const path = page.url.pathname;
		if (seg === '') return path === base || path === `${base}/`;
		return path === `${base}/${seg}` || path.startsWith(`${base}/${seg}/`);
	};
</script>

<div class="border-b border-border bg-surface">
	<div class="mx-auto w-full max-w-7xl px-3 pt-3 sm:px-6 sm:pt-6">
		<h1 class="text-lg font-semibold tracking-tight text-ink sm:text-xl">Kitchen</h1>
		<nav class="-mb-px mt-2 flex gap-1 overflow-x-auto sm:mt-4" aria-label="Kitchen sections">
			{#each tabs as tab (tab.seg)}
				<a
					href={tab.seg ? `${base}/${tab.seg}` : base}
					aria-current={isActive(tab.seg) ? 'page' : undefined}
					class="shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors {isActive(tab.seg)
						? 'border-brand text-ink'
						: 'border-transparent text-ink-muted hover:text-ink'}"
				>
					{tab.label}
				</a>
			{/each}
		</nav>
	</div>
</div>

{@render children()}
