<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
	const base = $derived(`/${page.params.hotel}/management/inventory`);

	const tabs = $derived(
		[
			{ seg: '', label: 'Stock' },
			{ seg: '/restock', label: 'Restock' },
			{ seg: '/shopping-list', label: 'Shopping list' },
			{ seg: '/counts', label: 'Counts' },
			{ seg: '/movements', label: 'Movements' },
			{ seg: '/items', label: 'Items', show: data.inventory.canManage },
			{ seg: '/suppliers', label: 'Suppliers', show: data.inventory.canManage }
		].filter((t) => t.show === undefined || t.show)
	);

	const active = (seg: string) => {
		const path = page.url.pathname;
		return seg === '' ? path === base || path === `${base}/` : path.startsWith(base + seg);
	};
</script>

<div class="flex min-h-full flex-col">
	<nav
		class="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-border bg-surface-2 px-4 py-2 sm:px-6 print:hidden"
		aria-label="Inventory"
	>
		{#each tabs as t (t.seg)}
			<a
				href={base + t.seg}
				aria-current={active(t.seg) ? 'page' : undefined}
				class="rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap {active(t.seg)
					? 'bg-surface text-ink shadow-sm'
					: 'text-ink-muted hover:text-ink'}"
			>
				{t.label}
			</a>
		{/each}
	</nav>
	<div class="flex-1">{@render children()}</div>
</div>
