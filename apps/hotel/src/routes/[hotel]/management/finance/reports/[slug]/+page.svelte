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

	// Overall / Hotel / Dining: the same report narrowed to one part of the business. Each link keeps
	// the date choices already on the page and only swaps the scope.
	const SCOPES = [
		{ key: 'all', label: 'Overall' },
		{ key: 'hotel', label: 'Hotel' },
		{ key: 'dining', label: 'Dining' }
	] as const;
	const withParams = (set: Record<string, string | null>) => {
		const p = new URLSearchParams(page.url.searchParams);
		for (const [k, v] of Object.entries(set)) {
			if (v === null) p.delete(k);
			else p.set(k, v);
		}
		const s = p.toString();
		return `${base}/${data.slug}${s ? `?${s}` : ''}`;
	};
	const scopeHref = (key: string) => withParams({ scope: key === 'all' ? null : key });

	// Quick periods for a date-range report, from the hotel's business date (weeks start on Monday).
	const periods = $derived.by(() => {
		const d = new Date(`${data.today}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
		return [
			{ label: 'Today', from: data.today },
			{ label: 'This week', from: d.toISOString().slice(0, 10) },
			{ label: 'This month', from: data.monthStart }
		];
	});
	const GROUPS = [
		{ key: 'day', label: 'Day' },
		{ key: 'week', label: 'Week' },
		{ key: 'month', label: 'Month' }
	] as const;
	const group = $derived(page.url.searchParams.get('group') ?? 'day');
	const link = (href: string) => `/${page.params.hotel}/management/${href}`;
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
	{#if data.scopable}
		<nav class="mb-3 flex flex-wrap items-center gap-1.5 print:hidden" aria-label="Report scope">
			{#each SCOPES as s (s.key)}
				<Button size="sm" variant={r.scope === s.key ? 'default' : 'outline'} href={scopeHref(s.key)}>{s.label}</Button>
			{/each}
			{#if r.scope === 'dining'}
				<span class="ml-2 text-xs text-ink-muted">
					Restaurant takings and refunds only. Room-charged dining counts once the room bill is paid.
				</span>
			{:else if r.scope === 'hotel'}
				<span class="ml-2 text-xs text-ink-muted">Rooms, halls, incidentals and room deposits. Restaurant takings are left out.</span>
			{/if}
			{#if data.groupable}
				<span class="ml-auto text-xs text-ink-muted">Group by</span>
				{#each GROUPS as g (g.key)}
					<Button size="sm" variant={group === g.key ? 'default' : 'outline'} href={withParams({ group: g.key === 'day' ? null : g.key })}>{g.label}</Button>
				{/each}
			{/if}
		</nav>
	{/if}
	<p class="mb-3 hidden text-sm text-black print:block">{page.data.hotel?.name ?? ''}</p>

	<form method="GET" class="mb-4 flex flex-wrap items-end gap-2 print:hidden">
		{#if r.kind === 'day'}
			<div><Label class="text-xs">Date</Label><Input name="date" type="date" value={data.params.date} class="mt-1 h-8" /></div>
		{:else if r.kind === 'asOf'}
			<div><Label class="text-xs">As of</Label><Input name="to" type="date" value={data.params.to} class="mt-1 h-8" /></div>
		{:else}
			<div class="flex w-full flex-wrap gap-1.5">
				{#each periods as p (p.label)}
					<Button size="sm" variant={data.params.from === p.from && data.params.to === data.today ? 'default' : 'outline'} href={withParams({ from: p.from, to: data.today })}>{p.label}</Button>
				{/each}
			</div>
			{#if page.url.searchParams.get('scope')}<input type="hidden" name="scope" value={page.url.searchParams.get('scope')} />{/if}
			{#if page.url.searchParams.get('group')}<input type="hidden" name="group" value={page.url.searchParams.get('group')} />{/if}
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

	{#each r.sections ?? [] as s (s.title)}
		<h2 class="mt-6 mb-2 text-sm font-semibold text-ink print:text-black">{s.title}</h2>
		<div class="overflow-x-auto rounded-xl border border-border print:overflow-visible print:rounded-none print:border-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						{#each s.columns as c (c)}<Table.Head class="whitespace-nowrap print:text-black">{c}</Table.Head>{/each}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each s.rows as row, ri (ri)}
						<Table.Row class="print:break-inside-avoid">
							{#each row as cell, ci (ci)}
								<Table.Cell class="tabular-nums text-ink print:text-black">
									{#if ci === s.linkColumn && s.hrefs?.[ri]}
										<a href={link(s.hrefs[ri]!)} class="font-mono underline underline-offset-2">{cell}</a>
									{:else}{cell}{/if}
								</Table.Cell>
							{/each}
						</Table.Row>
					{:else}
						<Table.Row><Table.Cell colspan={s.columns.length} class="py-6 text-center text-ink-muted">No data.</Table.Cell></Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/each}
</div>

<style>
	@media print {
		:global(body) {
			background: #fff;
		}
	}
</style>
