<script lang="ts">
	import { page } from '$app/state';
	import { invalidate } from '$app/navigation';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const base = $derived(`/${page.params.hotel}/management/kitchen`);

	// Board is the index route, so it matches the bare path and nothing else. The number on Board
	// is the tickets that still have a dish nobody has started.
	const tabs = $derived([
		{ seg: '', label: 'Board', badge: data.badges.kitchen },
		{ seg: 'prep', label: 'Prep', badge: 0 },
		{ seg: 'sold-out', label: 'Sold out', badge: 0 },
		{ seg: 'history', label: 'History', badge: 0 },
		{ seg: 'stations', label: 'Stations', badge: 0 }
	]);

	// Keep the number current on every Kitchen tab, not only while the board itself is open.
	$effect(() => {
		const refresh = () => {
			if (!document.hidden) invalidate('app:staff-badges');
		};
		const poll = setInterval(refresh, 12_000);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			clearInterval(poll);
			document.removeEventListener('visibilitychange', refresh);
		};
	});

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
					{#if tab.badge > 0}
						<span class="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand-ink" aria-label="{tab.badge} to start">{tab.badge}</span>
					{/if}
				</a>
			{/each}
		</nav>
	</div>
</div>

{@render children()}
