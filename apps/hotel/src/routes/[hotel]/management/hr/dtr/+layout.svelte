<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
	const base = $derived(`/${page.params.hotel}/management/hr/dtr`);
	const onBiometric = $derived(page.url.pathname.startsWith(`${base}/biometric`));
	const tabs = $derived([
		{ href: base, label: 'DTR records', active: !onBiometric },
		{ href: `${base}/biometric`, label: 'Biometric data', active: onBiometric }
	]);
</script>

<div>
	<nav class="flex gap-5 border-b border-border px-4 sm:px-6" aria-label="DTR sections">
		{#each tabs as t (t.href)}
			<a
				href={t.href}
				class="-mb-px border-b-2 py-2.5 text-sm font-medium whitespace-nowrap {t.active
					? 'border-primary text-ink'
					: 'border-transparent text-ink-muted hover:text-ink'}"
				aria-current={t.active ? 'page' : undefined}
			>
				{t.label}
			</a>
		{/each}
	</nav>
	{@render children()}
</div>
