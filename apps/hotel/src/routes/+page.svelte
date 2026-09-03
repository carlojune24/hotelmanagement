<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<header class="mb-8 flex items-center justify-between">
		<h1 class="text-xl font-semibold tracking-tight text-ink">MM Hotel</h1>
		<nav class="flex gap-2">
			{#if data.user}
				{#if data.user.isPlatformAdmin}
					<Button variant="outline" href="/admin">Admin</Button>
				{/if}
				<form method="POST" action="/auth/logout">
					<Button variant="outline" type="submit">Sign out</Button>
				</form>
			{:else}
				<Button href="/auth/login">Sign in</Button>
			{/if}
		</nav>
	</header>

	<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Published hotels</h2>
		{#if data.published.length === 0}
			<p class="mt-3 text-sm text-ink-muted">No hotels have been published yet.</p>
		{:else}
			<ul class="mt-3 divide-y divide-border/60">
				{#each data.published as h (h.slug)}
					<li class="flex items-center justify-between py-3">
						<div>
							<div class="font-medium text-ink">{h.name}</div>
							{#if h.city}<div class="text-xs text-ink-muted">{h.city}</div>{/if}
						</div>
						<div class="flex gap-2">
							<Button variant="outline" href="/{h.slug}">Staff</Button>
							<Button href="/{h.slug}/book">Book</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
