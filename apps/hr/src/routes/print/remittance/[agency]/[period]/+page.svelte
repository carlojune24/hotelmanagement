<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const money = (c: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
	const isBir = $derived(data.agency === 'bir');
	const hasEc = $derived(data.agency === 'sss');
</script>

<svelte:head><title>{data.label} remittance · {data.period}</title></svelte:head>

<div class="mx-auto flex max-w-4xl justify-end p-4 print:hidden">
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

<article class="mx-auto my-4 max-w-4xl bg-white p-8 text-sm text-ink shadow-sm print:my-0 print:shadow-none">
	{#if data.draftBatches > 0 || data.record?.status !== 'remitted'}
		<p class="mb-4 rounded border border-dashed border-ink/40 px-3 py-2 text-center text-xs tracking-wide uppercase">
			{data.record?.status === 'remitted' ? '' : 'Not yet remitted'}
			{data.draftBatches > 0 ? ' — incomplete: some payroll is not locked' : ''}
		</p>
	{/if}

	<header class="flex items-start justify-between border-b border-ink/30 pb-4">
		<div>
			<h1 class="text-xl font-semibold">{data.employer.name}</h1>
			{#if data.employerNo}<p class="text-ink-muted">{isBir ? 'TIN' : 'Employer no.'} {data.employerNo}</p>{/if}
		</div>
		<div class="text-right">
			<p class="text-lg font-semibold tracking-wide uppercase">{data.label}</p>
			<p class="tabular-nums">Pay month {data.period}</p>
			{#if data.record?.status === 'remitted'}
				<p class="text-ink-muted tabular-nums">Paid {data.record.remittedOn} · ref {data.record.referenceNo}</p>
			{/if}
		</div>
	</header>

	<table class="mt-4 w-full border-collapse">
		<thead>
			<tr class="border-b border-ink/30 text-left">
				<th class="py-1.5">Employee</th>
				<th>{isBir ? 'TIN' : 'ID number'}</th>
				<th class="text-right">{isBir ? 'Tax withheld' : 'Employee'}</th>
				{#if !isBir}<th class="text-right">Employer</th>{/if}
				{#if hasEc}<th class="text-right">EC</th>{/if}
				<th class="text-right">Total</th>
			</tr>
		</thead>
		<tbody>
			{#each data.schedule.rows as r (r.employeeId)}
				<tr class="border-b border-ink/10">
					<td class="py-1.5">{r.name} <span class="text-ink-muted">({r.employeeNo})</span></td>
					<td class="tabular-nums">{r.idNumber ?? '—'}</td>
					<td class="text-right tabular-nums">{money(r.employee)}</td>
					{#if !isBir}<td class="text-right tabular-nums">{money(r.employer)}</td>{/if}
					{#if hasEc}<td class="text-right tabular-nums">{money(r.ec)}</td>{/if}
					<td class="text-right tabular-nums">{money(r.total)}</td>
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr class="font-semibold">
				<td class="py-2" colspan="2">Total · {data.schedule.rows.length} {data.schedule.rows.length === 1 ? 'person' : 'people'}</td>
				<td class="text-right tabular-nums">{money(data.schedule.totals.employee)}</td>
				{#if !isBir}<td class="text-right tabular-nums">{money(data.schedule.totals.employer)}</td>{/if}
				{#if hasEc}<td class="text-right tabular-nums">{money(data.schedule.totals.ec)}</td>{/if}
				<td class="text-right tabular-nums">{money(data.schedule.totals.total)}</td>
			</tr>
		</tfoot>
	</table>

	<p class="mt-6 text-xs text-ink-muted">
		Computed from the statutory rates on file; not verified against the current circulars.
	</p>
</article>
