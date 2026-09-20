<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { errorCopy } from '$lib/error-copy';
	import CopyIcon from '@lucide/svelte/icons/copy';

	/** Operate-mode error body: used inside the staff and admin shells, and as the neutral
	 *  root fallback. Guest routes use their own Woven Ledger page instead. */
	let {
		status,
		message,
		ref,
		homeHref,
		homeLabel
	}: {
		status: number;
		message?: string;
		ref?: string;
		homeHref: string;
		homeLabel: string;
	} = $props();

	const copy = $derived(errorCopy(status, message));

	async function copyRef() {
		try {
			await navigator.clipboard.writeText(ref!);
			toast.success('Reference copied');
		} catch {
			toast.error('Could not copy — select the reference and copy it manually.');
		}
	}
</script>

<div class="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-6 py-16">
	<p class="font-mono text-sm tabular-nums text-muted-foreground">{status}</p>
	<h1 class="mt-2 text-2xl font-semibold tracking-tight text-balance">{copy.title}</h1>
	<p class="mt-3 max-w-[65ch] text-muted-foreground">{copy.body}</p>

	{#if ref}
		<div class="mt-6 flex items-center gap-2 border-t pt-4 text-sm">
			<span class="text-muted-foreground">Reference</span>
			<code class="font-mono font-medium select-all">{ref}</code>
			<Button variant="ghost" size="icon" class="size-7" aria-label="Copy reference" onclick={copyRef}>
				<CopyIcon class="size-3.5" />
			</Button>
		</div>
	{/if}

	<div class="mt-8 flex flex-wrap gap-3">
		<Button href={homeHref}>{homeLabel}</Button>
		{#if copy.retryable}
			<Button variant="outline" onclick={() => invalidateAll()}>Try again</Button>
		{/if}
	</div>
</div>
