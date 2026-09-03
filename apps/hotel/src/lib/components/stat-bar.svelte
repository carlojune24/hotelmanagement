<script lang="ts">
	import type { Component } from 'svelte';

	interface Stat {
		icon?: Component<{ class?: string }>;
		value: string;
		label: string;
	}

	let { stats }: { stats: Stat[] } = $props();
</script>

<div
	class="mt-4 flex divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-2 shadow-sm"
>
	{#each stats as stat, i (i)}
		<div class="min-w-0 flex-1 px-4 py-3">
			{#if stat.icon}
				<stat.icon class="size-4 text-brand" />
			{/if}
			<div class="mt-1.5 truncate text-lg font-semibold tracking-tight text-ink">
				{stat.value}
			</div>
			<div class="truncate text-xs text-ink-muted">{stat.label}</div>
		</div>
	{/each}
</div>
