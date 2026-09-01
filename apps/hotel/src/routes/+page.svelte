<script lang="ts">
	import { ui } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class={ui.page}>
	<header class="mb-8 flex items-center justify-between">
		<h1 class={ui.h1}>MM Hotel</h1>
		<nav class="flex gap-2">
			{#if data.user}
				{#if data.user.isPlatformAdmin}
					<a class="{ui.btn} {ui.btnGhost}" href="/admin">Admin</a>
				{/if}
				<form method="POST" action="/auth/logout">
					<button class="{ui.btn} {ui.btnGhost}" type="submit">Sign out</button>
				</form>
			{:else}
				<a class="{ui.btn} {ui.btnPrimary}" href="/auth/login">Sign in</a>
			{/if}
		</nav>
	</header>

	<section class={ui.card}>
		<h2 class={ui.h2}>Published hotels</h2>
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
							<a class="{ui.btn} {ui.btnGhost}" href="/{h.slug}">Staff</a>
							<a class="{ui.btn} {ui.btnPrimary}" href="/{h.slug}/book">Book</a>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
