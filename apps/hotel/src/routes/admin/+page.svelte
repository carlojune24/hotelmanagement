<script lang="ts">
	import { ui } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const tiles = $derived([
		{ label: 'Hotels', value: data.stats.hotels, href: '/admin/hotels' },
		{ label: 'Published', value: data.stats.published, href: '/admin/hotels' },
		{ label: 'Users', value: data.stats.users, href: '/admin/users' }
	]);

	const webhookUrl = $derived(
		data.devTunnelUrl ? `${data.devTunnelUrl}/api/webhooks/paymongo` : null
	);
</script>

<div class={ui.page}>
	<h1 class="{ui.h1} mb-6">Overview</h1>
	<div class="grid gap-4 sm:grid-cols-3">
		{#each tiles as t (t.label)}
			<a href={t.href} class="{ui.card} block hover:border-brand">
				<div class={ui.h2}>{t.label}</div>
				<div class="mt-2 text-3xl font-semibold text-ink">{t.value}</div>
			</a>
		{/each}
	</div>

	{#if data.devTunnelUrl}
		<div class="{ui.card} mt-4">
			<div class={ui.h2}>Dev tunnel (cloudflared)</div>
			<p class="mt-2 text-sm text-ink-muted">
				Use this as the PayMongo webhook URL while testing locally:
			</p>
			<code
				class="mt-2 block break-all rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
			>
				{webhookUrl}
			</code>
		</div>
	{/if}
</div>
