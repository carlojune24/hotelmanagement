<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const base = $derived(`/${page.params.hotel}/management/finance/reports`);
	const r = $derived(data.result);
	const qs = $derived(page.url.searchParams.toString());
	const csvHref = $derived(`${base}/${data.slug}/export${qs ? `?${qs}` : ''}`);
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex items-center justify-between print:hidden">
		<a href={base} class="text-sm text-ink-muted underline underline-offset-2">← Reports</a>
		<div class="flex items-center gap-3">
			<button type="button" onclick={() => window.print()} class="text-sm text-ink-muted underline underline-offset-2 hover:text-ink">
				Print
			</button>
			<a href={csvHref} class="text-sm text-ink-muted underline underline-offset-2">Download CSV</a>
		</div>
	</div>
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink print:text-black">{r.name}</h1>
	<p class="mb-3 hidden text-sm text-black print:block">{page.data.hotel?.name ?? ''}</p>

	<form method="GET" class="mb-4 flex flex-wrap items-end gap-2 print:hidden">
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

	<dl class="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm print:text-black">
		{#each r.summary as [k, v] (k)}
			<div><dt class="inline text-ink-muted print:text-black">{k}:</dt> <dd class="inline font-medium text-ink tabular-nums print:text-black">{v}</dd></div>
		{/each}
	</dl>

	<div class="overflow-x-auto rounded-xl border border-border print:overflow-visible print:rounded-none print:border-0">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					{#each r.columns as c, i (c)}
						<Table.Head class={i === 0 ? 'print:text-black' : 'text-right print:text-black'}>{c}</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each r.rows as row, ri (ri)}
					<Table.Row class="print:break-inside-avoid">
						{#each row as cell, ci (ci)}
							<Table.Cell class={ci === 0 ? 'text-ink print:text-black' : 'text-right tabular-nums text-ink-muted print:text-black'}>{cell}</Table.Cell>
						{/each}
					</Table.Row>
				{:else}
					<Table.Row><Table.Cell colspan={r.columns.length} class="py-6 text-center text-ink-muted">No data.</Table.Cell></Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>

<style>
	@media print {
		:global(body) {
			background: #fff;
		}
	}
</style>
