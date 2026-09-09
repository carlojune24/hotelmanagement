<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { children }: { data: LayoutData; children: Snippet } = $props();
	const base = $derived(`/${page.params.hotel}/finance/bir`);

	const tabs = [
		{ seg: '/setup', label: 'Setup' },
		{ seg: '/series', label: 'Series' },
		{ seg: '/documents', label: 'Documents' },
		{ seg: '/accountable-forms', label: 'Accountable forms' },
		{ seg: '/readings', label: 'Readings' }
	];
	const active = (seg: string) => page.url.pathname.startsWith(base + seg);
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">BIR accountable forms</h1>
	<p class="mb-4 text-sm text-ink-muted">
		Tax identity, registered serial ranges, and the Invoices &amp; Official Receipts issued from them.
	</p>

	<nav class="mb-6 flex gap-1 border-b border-border">
		{#each tabs as t (t.seg)}
			<a
				href={base + t.seg}
				class="rounded-t-md px-3 py-1.5 text-sm font-medium {active(t.seg)
					? 'border-b-2 border-ink text-ink'
					: 'text-ink-muted hover:text-ink'}"
			>
				{t.label}
			</a>
		{/each}
	</nav>

	{@render children()}
</div>
