<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { RANGE_LABEL, RANGE_PRESETS, type ResolvedRange } from '$lib/city/range';

	let { range }: { range: ResolvedRange } = $props();

	const presets = RANGE_PRESETS.filter((p) => p !== 'custom');
</script>

<!-- One row above everything it scopes: presets first, then a custom range. -->
<div class="flex flex-wrap items-end gap-x-6 gap-y-3">
	<nav class="flex flex-wrap gap-1" aria-label="Period">
		{#each presets as p (p)}
			<a
				href="?range={p}"
				aria-current={range.preset === p ? 'page' : undefined}
				class="rounded-md px-2.5 py-1.5 text-sm {range.preset === p
					? 'bg-brand/15 font-medium text-ink'
					: 'text-ink-muted hover:bg-surface-2 hover:text-ink'}"
			>
				{RANGE_LABEL[p]}
			</a>
		{/each}
	</nav>
	<form method="GET" class="flex flex-wrap items-end gap-2">
		<input type="hidden" name="range" value="custom" />
		<div>
			<Label for="from" class="text-xs text-ink-muted">From</Label>
			<Input id="from" name="from" type="date" value={range.from} required class="mt-1 h-8 w-40" />
		</div>
		<div>
			<Label for="to" class="text-xs text-ink-muted">To</Label>
			<Input id="to" name="to" type="date" value={range.to} required class="mt-1 h-8 w-40" />
		</div>
		<Button type="submit" variant={range.preset === 'custom' ? 'default' : 'outline'} class="h-8">Apply</Button>
	</form>
</div>
{#if range.error}
	<p class="mt-2 text-sm text-danger" role="alert">{range.error} Showing the last 12 months.</p>
{/if}
