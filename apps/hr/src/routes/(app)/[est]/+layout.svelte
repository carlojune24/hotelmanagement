<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
	const base = $derived(`/${page.params.est}`);

	const tabs = $derived(
		[
			{ seg: '/dashboard', label: 'Dashboard', show: data.tabs.dashboard },
			{ seg: '/employees', label: 'Employees', show: data.tabs.employees },
			{ seg: '/schedule', label: 'Schedule', show: data.tabs.schedule },
			{ seg: '/dtr', label: 'DTR', show: data.tabs.dtr },
			{ seg: '/leave', label: 'Leave', show: data.tabs.leave },
			{ seg: '/overtime', label: 'Overtime', show: data.tabs.overtime },
			{ seg: '/payslips', label: 'Payslips', show: data.tabs.payslips },
			{ seg: '/settings', label: 'Settings', show: data.tabs.settings }
		].filter((t) => t.show)
	);

	const active = (seg: string) => page.url.pathname.startsWith(base + seg);
</script>

<svelte:head><title>{data.establishment.name} · HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-5">
	<header class="flex flex-wrap items-end justify-between gap-3">
		<div>
			{#if !data.scope}
				<p class="text-sm text-ink-muted">
					<a href="/establishments" class="underline-offset-4 hover:underline">Establishments</a>
				</p>
			{/if}
			<h1 class="text-4xl font-light tracking-tight">{data.establishment.name}</h1>
		</div>
		<!-- A manager or clerk has these in the sidebar; Main HR keeps them here and the company menu there. -->
		<nav class="flex flex-wrap gap-2 {data.scope ? 'hidden' : ''}" aria-label="Establishment sections">
			{#each tabs as t (t.seg)}
				<a
					href={base + t.seg}
					aria-current={active(t.seg) ? 'page' : undefined}
					class="rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors {active(t.seg)
						? 'bg-primary text-primary-foreground'
						: 'bg-white/70 text-ink hover:bg-gold-soft'}"
				>
					{t.label}
				</a>
			{/each}
		</nav>
	</header>

	<div class="panel overflow-hidden">{@render children()}</div>
</div>
