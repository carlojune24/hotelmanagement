<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
	const base = $derived(`/${page.params.hotel}/finance`);

	const tabs = $derived(
		[
			{ seg: '', label: 'Dashboard' },
			{ seg: '/cash', label: 'Cash' },
			{ seg: '/expenses', label: 'Expenses', show: data.finance.canExpense || data.finance.canWrite },
			{ seg: '/receivables', label: 'City ledger' },
			{ seg: '/shifts', label: 'Shifts' },
			{ seg: '/reports', label: 'Reports' },
			{ seg: '/bir', label: 'BIR' },
			{ seg: '/settings', label: 'Settings', show: data.finance.canAdmin }
		].filter((t) => t.show === undefined || t.show)
	);

	const active = (seg: string) => {
		const path = page.url.pathname;
		return seg === '' ? path === base || path === `${base}/` : path.startsWith(base + seg);
	};
</script>

<div class="flex min-h-full flex-col">
	<nav class="flex gap-1 overflow-x-auto border-b border-border bg-surface-2 px-4 py-2 sm:px-6">
		{#each tabs as t (t.seg)}
			<a
				href={base + t.seg}
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
