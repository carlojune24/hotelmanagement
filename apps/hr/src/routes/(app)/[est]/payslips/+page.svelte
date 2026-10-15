<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const selectClass =
		'h-10 rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
	const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	const active = $derived(data.filter.run || data.filter.year || data.filter.month);
	const money = (c: number) =>
		new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
</script>

<svelte:head><title>Payslips · HR</title></svelte:head>

<div class="space-y-6 p-4 sm:p-6">
	<div>
		<h2 class="text-base font-semibold text-ink">Payslips</h2>
		<p class="text-sm text-ink-muted">
			Released by Main HR for the people based here. Government numbers are masked.
		</p>
	</div>

	{#if data.filtered}
		<!-- GET form: the filter lives in the URL so it survives reload and can be shared. Run and year/month never combine. -->
		<form method="GET" class="flex flex-wrap items-end gap-3" aria-label="Filter payslips">
			<label class="grid gap-1 text-xs text-ink-muted">
				Payroll run
				<select name="run" class={selectClass} value={data.filter.run} onchange={(e) => {
					if (e.currentTarget.value) e.currentTarget.form!.querySelectorAll<HTMLSelectElement>('[data-ym]').forEach((s) => (s.value = ''));
					e.currentTarget.form!.requestSubmit();
				}}>
					<option value="">All runs</option>
					{#each data.runs as r (r.id)}<option value={r.id}>{r.label}</option>{/each}
				</select>
			</label>
			<label class="grid gap-1 text-xs text-ink-muted">
				Year
				<select name="year" data-ym class={selectClass} value={data.filter.year} onchange={(e) => {
					const f = e.currentTarget.form!;
					f.querySelector<HTMLSelectElement>('[name=run]')!.value = '';
					if (!e.currentTarget.value) f.querySelector<HTMLSelectElement>('[name=month]')!.value = '';
					f.requestSubmit();
				}}>
					<option value="">All years</option>
					{#each data.years as y (y)}<option value={y}>{y}</option>{/each}
				</select>
			</label>
			<label class="grid gap-1 text-xs text-ink-muted">
				Month
				<select name="month" data-ym class={selectClass} value={data.filter.month}
					onchange={(e) => {
						e.currentTarget.form!.querySelector<HTMLSelectElement>('[name=run]')!.value = '';
						e.currentTarget.form!.requestSubmit();
					}}>
					<option value="">All months</option>
					{#each MONTHS as m, i (m)}<option value={String(i + 1).padStart(2, '0')}>{m}</option>{/each}
				</select>
			</label>
			{#if active}<Button variant="ghost" size="sm" href="?">Clear</Button>{/if}
		</form>
	{/if}

	{#each data.groups as g (g.cutoffStart + g.cutoffEnd)}
		<section class="space-y-2">
			<h3 class="text-sm font-medium tabular-nums">
				{g.cutoffStart} → {g.cutoffEnd}
				<span class="font-normal text-ink-muted">· pay date {g.payDate}</span>
			</h3>
			<div class="overflow-hidden rounded-2xl border border-border">
				<Table.Root>
					<Table.Header>
						<Table.Row class="hover:bg-transparent">
							<Table.Head>Employee</Table.Head>
							<Table.Head>Position</Table.Head>
							<Table.Head class="text-right">Net pay</Table.Head>
							<Table.Head><span class="sr-only">Payslip</span></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each g.slips as s (s.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{s.employeeName} <span class="font-normal text-ink-muted">#{s.employeeNo}</span></Table.Cell>
								<Table.Cell class="text-ink-muted">{s.position}</Table.Cell>
								<Table.Cell class="text-right tabular-nums">{money(s.netPayCentavos)}</Table.Cell>
								<Table.Cell class="text-right">
									<Button
										variant="outline"
										size="sm"
										href="/print/{page.params.est}/payslip/{s.id}"
										target="_blank"
										rel="noopener">View / print</Button
									>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</section>
	{:else}
		<div class="hatch rounded-2xl px-6 py-14 text-center">
			{#if data.filtered}
				<p class="text-lg">No payslips match this filter</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">Try another run or month, or clear the filter.</p>
			{:else}
				<p class="text-lg">No payslips released yet</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
					They appear here once Main HR releases a payroll run for this establishment.
				</p>
			{/if}
		</div>
	{/each}
</div>
