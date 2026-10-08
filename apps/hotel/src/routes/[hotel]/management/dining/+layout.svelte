<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const base = $derived(`/${page.params.hotel}/management/dining`);

	// Orders and Reservations join this strip as each one ships.
	const tabs = $derived(
		[
			{ seg: 'floor-plan', label: 'Floor plan', show: true },
			{ seg: 'menu', label: 'Menu', show: true },
			{ seg: 'addons', label: 'Add-ons', show: true },
			{ seg: 'stations', label: 'Stations', show: true },
			{ seg: 'settings', label: 'Venues & page', show: data.canEditSettings }
		].filter((t) => t.show)
	);

	const isActive = (seg: string) => {
		const path = page.url.pathname;
		return path === `${base}/${seg}` || path.startsWith(`${base}/${seg}/`);
	};
</script>

<div class="border-b border-border bg-surface">
	<div class="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
		<h1 class="text-xl font-semibold tracking-tight text-ink">Dining</h1>
		<nav class="-mb-px mt-4 flex gap-1" aria-label="Dining sections">
			{#each tabs as tab (tab.seg)}
				<a
					href="{base}/{tab.seg}"
					aria-current={isActive(tab.seg) ? 'page' : undefined}
					class="border-b-2 px-3 py-2 text-sm font-medium transition-colors {isActive(tab.seg)
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
