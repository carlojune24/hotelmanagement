<script lang="ts">
	import HelpIcon from '@lucide/svelte/icons/circle-help';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';

	let { rates }: { rates: readonly { name: string; rule: string; since: string }[] } = $props();
</script>

<Popover.Root>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" class="gap-1.5">
				<HelpIcon class="size-4" /> Rates in force
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class="w-[28rem] max-w-[calc(100vw-2rem)] space-y-3 text-sm text-ink">
		<p class="font-medium">The {rates.length} rates this run applies</p>
		<p class="text-xs text-ink-muted">
			These are the published figures this system applies. They are not fetched live — check them against the
			current SSS, PhilHealth, Pag-IBIG and BIR issuances before locking any batch.
		</p>
		<ul class="space-y-1">
			{#each rates as r (r.name)}
				<li class="rounded-xl bg-white/70 px-3 py-2">
					<span class="font-medium">{r.name}</span> — {r.rule}
					<span class="text-xs text-ink-muted"> (since {r.since})</span>
				</li>
			{/each}
		</ul>
	</Popover.Content>
</Popover.Root>
