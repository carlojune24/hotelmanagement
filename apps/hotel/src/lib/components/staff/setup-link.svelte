<script lang="ts">
	import { page } from '$app/state';
	import { roleCan } from '$lib/authz';
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * A "go and set this up" pointer that never leads to a 403. Anyone holding `cap` gets the link;
	 * everyone else is told who can do it. `to` is relative to `/{slug}/management`.
	 */
	let {
		to,
		cap = 'hotel:admin',
		variant = 'button',
		children
	}: {
		to: string;
		cap?: string;
		variant?: 'button' | 'text';
		children: import('svelte').Snippet;
	} = $props();

	const base = $derived(`/${page.params.hotel}/management`);
	const allowed = $derived(
		!!page.data.user?.isPlatformAdmin ||
			(!!page.data.role && roleCan(page.data.role.capabilities as string[], cap))
	);
</script>

{#if allowed}
	{#if variant === 'button'}
		<Button href="{base}/{to}" variant="outline">{@render children()}</Button>
	{:else}
		<a href="{base}/{to}" class="text-xs text-ink-muted underline underline-offset-2">
			{@render children()} →
		</a>
	{/if}
{:else}
	<span class="text-xs text-ink-muted">Ask a hotel admin to set this up.</span>
{/if}
