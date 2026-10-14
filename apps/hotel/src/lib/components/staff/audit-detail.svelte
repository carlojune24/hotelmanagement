<script lang="ts">
	import { browserOf } from '$lib/audit-labels';

	/**
	 * The expanded part of an audit entry: where it came from and the before / after data.
	 * Only ever given to hotel admins (the guest IP is personal data), so the callers pass
	 * nothing for anyone else and this renders nothing.
	 */
	let {
		ip = null,
		userAgent = null,
		before = null,
		after = null
	}: { ip?: string | null; userAgent?: string | null; before?: unknown; after?: unknown } = $props();

	const hasDevice = $derived(!!ip || !!userAgent);
</script>

<div class="space-y-3 py-1">
	{#if hasDevice}
		<dl class="flex flex-wrap gap-x-6 gap-y-1 text-xs">
			{#if ip}
				<div class="flex gap-1.5">
					<dt class="font-semibold tracking-wide text-ink-muted uppercase">IP address</dt>
					<dd class="font-mono text-ink">{ip}</dd>
				</div>
			{/if}
			{#if userAgent}
				<div class="flex min-w-0 gap-1.5">
					<dt class="font-semibold tracking-wide text-ink-muted uppercase">Browser</dt>
					<dd class="min-w-0 text-ink" title={userAgent}>{browserOf(userAgent)}</dd>
				</div>
			{/if}
		</dl>
	{/if}
	{#if before != null || after != null}
		<div class="grid gap-3 sm:grid-cols-2">
			{#if before != null}
				<div>
					<div class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Before</div>
					<pre class="overflow-x-auto rounded-md border border-border bg-surface p-2 text-xs text-ink">{JSON.stringify(before, null, 2)}</pre>
				</div>
			{/if}
			{#if after != null}
				<div>
					<div class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">After</div>
					<pre class="overflow-x-auto rounded-md border border-border bg-surface p-2 text-xs text-ink">{JSON.stringify(after, null, 2)}</pre>
				</div>
			{/if}
		</div>
	{/if}
</div>
