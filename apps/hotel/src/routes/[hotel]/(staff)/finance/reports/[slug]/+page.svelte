<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const base = $derived(`/${page.params.hotel}/finance/reports`);
	const r = $derived(data.result);
	const qs = $derived(page.url.searchParams.toString());
	const csvHref = $derived(`${base}/${data.slug}/export${qs ? `?${qs}` : ''}`);
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex items-center justify-between">
		<a href={base} class="text-sm text-ink-muted underline underline-offset-2">← Reports</a>
		<a href={csvHref} class="text-sm text-ink-muted underline underline-offset-2">Download CSV</a>
	</div>
	<h1 class="mb-3 text-xl font-semibold tracking-tight text-ink">{r.name}</h1>

	<form method="GET" class="mb-4 flex flex-wrap items-end gap-2">
		{#if r.kind === 'day'}
			<div><Label class="text-xs">Date</Label><Input name="date" type="date" value={data.params.date} class="mt-1 h-8" /></div>
		{:else if r.kind === 'asOf'}
			<div><Label class="text-xs">As of</Label><Input name="to" type="date" value={data.params.to} class="mt-1 h-8" /></div>
		{:else}
			<div><Label class="text-xs">From</Label><Input name="from" type="date" value={data.params.from} class="mt-1 h-8" /></div>
			<div><Label class="text-xs">To</Label><Input name="to" type="date" value={data.params.to} class="mt-1 h-8" /></div>
		{/if}
		<Button type="submit" size="sm" variant="outline">Run</Button>
	</form>

	<dl class="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
		{#each r.summary as [k, v] (k)}
			<div><dt class="inline text-ink-muted">{k}:</dt> <dd class="inline font-medium text-ink tabular-nums">{v}</dd></div>
		{/each}
	</dl>

	<div class="overflow-x-auto rounded-xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					{#each r.columns as c, i (c)}
						<Table.Head class={i === 0 ? '' : 'text-right'}>{c}</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each r.rows as row, ri (ri)}
					<Table.Row>
						{#each row as cell, ci (ci)}
							<Table.Cell class={ci === 0 ? 'text-ink' : 'text-right tabular-nums text-ink-muted'}>{cell}</Table.Cell>
						{/each}
					</Table.Row>
				{:else}
					<Table.Row><Table.Cell colspan={r.columns.length} class="py-6 text-center text-ink-muted">No data.</Table.Cell></Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
