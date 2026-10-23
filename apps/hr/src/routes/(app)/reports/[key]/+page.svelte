<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import { money } from '$lib/components/payroll/money';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	let f = $state({ ...data.p });
	const qs = $derived.by(() => {
		const q = new URLSearchParams();
		if (data.filter === 'asOf') q.set('asOf', f.asOf);
		if (data.filter === 'monthRange') {
			q.set('fromMonth', f.fromMonth);
			q.set('toMonth', f.toMonth);
		}
		if (data.filter === 'year') q.set('year', String(f.year));
		if (data.filter === 'dateRange') {
			q.set('from', f.from);
			q.set('to', f.to);
		}
		if (f.est) q.set('est', f.est);
		if (data.filter === 'monthRange' && f.drafts) q.set('drafts', '1');
		return q.toString();
	});
	const apply = () => goto(`?${qs}`, { keepFocus: true, noScroll: true });
	const key = $derived(page.params.key);
	const cell = (v: string | number, isMoney: boolean) => (isMoney && typeof v === 'number' ? money(v) : v);
	const withEst = $derived(data.filter !== 'year' && (data.filter !== 'dateRange' || data.doc.key !== 'turnover'));
</script>

<section class="panel space-y-5 p-5 md:p-6" aria-label={data.doc.title}>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="max-w-xl">
			<h2 class="text-2xl font-light">{data.doc.title}</h2>
			<p class="mt-1 text-sm text-ink-muted">{data.doc.period}</p>
		</div>
		<div class="flex gap-2">
			{#if key === '2316'}
				<Button variant="outline" href="/print/2316?{qs}" target="_blank" rel="noopener"><PrinterIcon /> Print certificates</Button>
			{/if}
			<Button variant="outline" href="/print/reports/{key}?{qs}" target="_blank" rel="noopener"><PrinterIcon /> Print</Button>
			<Button variant="outline" href="/reports/{key}/csv?{qs}" data-sveltekit-reload><DownloadIcon /> CSV</Button>
		</div>
	</div>

	<div class="flex flex-wrap items-end gap-3">
		{#if data.filter === 'asOf'}
			<div class="space-y-1.5">
				<Label for="asOf">As of</Label>
				<Input id="asOf" type="date" bind:value={f.asOf} onchange={apply} class="w-44" />
			</div>
		{:else if data.filter === 'monthRange'}
			<div class="space-y-1.5">
				<Label for="fromMonth">From month</Label>
				<Input id="fromMonth" type="month" bind:value={f.fromMonth} onchange={apply} class="w-44" />
			</div>
			<div class="space-y-1.5">
				<Label for="toMonth">To month</Label>
				<Input id="toMonth" type="month" bind:value={f.toMonth} onchange={apply} class="w-44" />
			</div>
		{:else if data.filter === 'year'}
			<div class="space-y-1.5">
				<Label for="year">Year</Label>
				<Input id="year" type="number" min="2000" max="2100" bind:value={f.year} onchange={apply} class="w-32" />
			</div>
		{:else}
			<div class="space-y-1.5">
				<Label for="from">From</Label>
				<Input id="from" type="date" bind:value={f.from} onchange={apply} class="w-44" />
			</div>
			<div class="space-y-1.5">
				<Label for="to">To</Label>
				<Input id="to" type="date" bind:value={f.to} onchange={apply} class="w-44" />
			</div>
		{/if}
		{#if withEst}
			<div class="space-y-1.5">
				<Label for="est">Establishment</Label>
				<select
					id="est"
					bind:value={f.est}
					onchange={apply}
					class="h-10 w-56 rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<option value="">All establishments</option>
					{#each data.establishments as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
				</select>
			</div>
		{/if}
		{#if data.filter === 'monthRange'}
			<label class="flex h-10 items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={f.drafts} onchange={apply} class="size-4 accent-[var(--gold-deep)]" />
				Include draft payslips
			</label>
		{/if}
	</div>

	<dl class="flex flex-wrap gap-x-10 gap-y-3">
		{#each data.doc.stats as s (s.label)}
			<div>
				<dt class="text-xs text-ink-muted">{s.label}</dt>
				<dd class="font-display text-3xl font-light tabular-nums">{s.money ? money(s.raw ?? 0) : s.value}</dd>
			</div>
		{/each}
	</dl>
	{#each data.doc.notes as n (n)}<p class="text-xs text-ink-muted">{n}</p>{/each}

	{#each data.doc.sections as sec (sec.title)}
		<div>
			<h3 class="mb-1 text-lg font-light">{sec.title}</h3>
			<div class="overflow-x-auto">
				{#if sec.rows.length === 0}
					<p class="py-3 text-sm text-ink-muted">Nothing to show for this period.</p>
				{:else}
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-ink/20 text-xs text-ink-muted">
								{#each sec.head as h, i (i)}
									<th class="py-2 pr-3 font-medium whitespace-nowrap {sec.numCols?.includes(i) ? 'text-right' : 'text-left'}">{h}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each sec.rows as row, ri (ri)}
								<tr class="border-b border-dotted border-ink/25">
									{#each row as v, i (i)}
										<td class="py-1.5 pr-3 whitespace-nowrap {sec.numCols?.includes(i) ? 'text-right tabular-nums' : ''}">{cell(v, !!sec.moneyCols?.includes(i))}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</div>
	{/each}
</section>
