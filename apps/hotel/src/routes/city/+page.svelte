<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const rows = $derived([
		{ label: 'Hotels registered', value: data.stats.hotels, href: '/city/hotels' },
		{ label: 'Hotels published', value: data.stats.published, href: '/city/hotels' },
		{ label: 'Rooms', value: data.stats.rooms, href: '/city/hotels' },
		{ label: 'Users', value: data.stats.users, href: '/city/users' },
		{ label: 'Permits expiring soon', value: data.permits.expiring, href: '/city/permits?status=expiring' },
		{ label: 'Permits expired', value: data.permits.expired, href: '/city/permits?status=expired' }
	]);
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
	<h1 class="text-xl font-semibold tracking-tight text-ink">Overview</h1>
	<p class="mt-1 text-sm text-ink-muted">
		Hotels on this city instance. Income, tourist statistics and ratings reports will appear here
		as they are built.
	</p>

	<dl class="mt-6 divide-y divide-border border-y border-border">
		{#each rows as r (r.label)}
			<a href={r.href} class="flex items-baseline justify-between py-3 hover:bg-surface-2">
				<dt class="text-sm text-ink-muted">{r.label}</dt>
				<dd class="font-mono text-lg font-medium tabular-nums text-ink">{r.value}</dd>
			</a>
		{/each}
	</dl>
</div>
