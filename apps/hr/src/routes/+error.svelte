<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
</script>

<main class="grid min-h-dvh place-items-center p-6">
	<div class="panel w-full max-w-md space-y-4 p-8 text-center">
		<p class="text-sm text-ink-muted">{page.status}</p>
		<h1 class="text-3xl font-light">
			{page.status === 404 ? 'Page not found' : page.status === 403 ? 'No access' : 'Something went wrong'}
		</h1>
		<p class="text-sm text-ink-muted">{page.error?.message}</p>
		{#if page.error?.ref}
			<p class="text-xs text-ink-muted">Reference: <span class="font-mono">{page.error.ref}</span></p>
		{/if}
		<Button href="/">Back to start</Button>
	</div>
</main>
