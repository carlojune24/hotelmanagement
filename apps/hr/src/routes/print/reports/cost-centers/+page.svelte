<script lang="ts">
	import { money } from '$lib/components/payroll/money';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const monthLabel = $derived(
		new Date(`${data.report.month}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
	);
	const printed = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
</script>

<svelte:head>
	<title>Cost by cost center · {monthLabel}</title>
	<style>
		@page {
			size: A4 portrait;
			margin: 12mm;
		}
	</style>
</svelte:head>

<div class="mx-auto flex max-w-4xl justify-end p-4 print:hidden">
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

<article class="mx-auto my-4 max-w-4xl bg-white p-8 text-sm text-ink shadow-sm print:my-0 print:shadow-none">
	<header class="flex items-start justify-between border-b border-ink/30 pb-4">
		<div>
			{#if data.logoUrl}<img src={data.logoUrl} alt="" class="mb-2 h-12 w-auto max-w-48 object-contain" />{/if}
			<h1 class="text-xl font-semibold">{data.company}</h1>
			<p class="text-ink-muted">Cost by cost center · {monthLabel}</p>
			<p class="text-ink-muted">{data.scope}</p>
		</div>
		<div class="text-right text-ink-muted">
			<p>Printed {printed}</p>
			{#if data.report.draftLines > 0}
				<p class="mt-1 rounded border border-dashed border-ink/40 px-2 py-1 text-xs uppercase">
					Includes {data.report.draftLines} draft payslip{data.report.draftLines === 1 ? '' : 's'}
				</p>
			{/if}
		</div>
	</header>

	{#if data.report.lines === 0}
		<p class="py-8 text-center text-ink-muted">No payslips for this month.</p>
	{:else}
		<table class="mt-4 w-full border-collapse">
			<thead>
				<tr class="border-b border-ink/30 text-right">
					<th class="py-1.5 text-left">Cost center</th>
					<th>People</th>
					<th>Gross</th>
					<th>Employer</th>
					<th>Total</th>
				</tr>
			</thead>
			<tbody>
				{#each data.report.centers as c (c.code ?? '')}
					<tr class="border-b border-ink/20 text-right font-medium break-inside-avoid">
						<td class="py-1.5 text-left">{c.code ? `${c.code} · ` : ''}{c.name}</td>
						<td class="tabular-nums">{c.people}</td>
						<td class="tabular-nums">{money(c.gross)}</td>
						<td class="tabular-nums">{money(c.employer)}</td>
						<td class="tabular-nums">{money(c.total)}</td>
					</tr>
					{#each c.persons as p (p.employeeId)}
						<tr class="border-b border-dotted border-ink/15 text-right text-xs break-inside-avoid">
							<td class="py-1 pl-4 text-left text-ink-muted">{p.name} · #{p.employeeNo} · {p.establishment}</td>
							<td></td>
							<td class="tabular-nums">{money(p.gross)}</td>
							<td class="tabular-nums">{money(p.employer)}</td>
							<td class="tabular-nums">{money(p.total)}</td>
						</tr>
					{/each}
				{/each}
			</tbody>
			<tfoot>
				<tr class="border-t border-ink/40 text-right font-semibold">
					<td class="py-2 text-left">Total</td>
					<td class="tabular-nums">{data.report.totals.people}</td>
					<td class="tabular-nums">{money(data.report.totals.gross)}</td>
					<td class="tabular-nums">{money(data.report.totals.employer)}</td>
					<td class="tabular-nums">{money(data.report.totals.total)}</td>
				</tr>
			</tfoot>
		</table>
	{/if}
</article>
