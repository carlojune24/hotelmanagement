<script lang="ts">
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
	const tunnelProvider = $derived(
		data.devTunnelUrl?.includes('.ngrok') ? 'ngrok' : 'cloudflared'
	);
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<h1 class="mb-6 text-xl font-semibold tracking-tight text-ink">Overview</h1>
	<div class="grid gap-4 sm:grid-cols-3">
		{#each tiles as t (t.label)}
			<a
				href={t.href}
				class="block rounded-xl border border-border bg-surface-2 p-5 shadow-sm hover:border-brand"
			>
				<div class="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t.label}</div>
				<div class="mt-2 text-3xl font-semibold text-ink">{t.value}</div>
			</a>
		{/each}
	</div>

	{#if data.devTunnelUrl}
		<div class="mt-4 rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<div class="text-sm font-semibold uppercase tracking-wide text-ink-muted">
				Dev tunnel ({tunnelProvider})
			</div>
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
