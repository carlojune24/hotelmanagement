<script lang="ts">
	import { money } from '$lib/components/payroll/money';
	import { CATEGORY_LABEL } from '$lib/pay-items-core';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const day = (d: string) =>
		new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
	const when = (i: { startDate: string; endDate: string | null }) =>
		i.endDate === i.startDate ? `Cutoff of ${day(i.startDate)}` : `${day(i.startDate)} to ${i.endDate ? day(i.endDate) : 'until voided'}`;
	const STATUS = { pending: 'Waiting', draft: 'Draft payslip', locked: 'Locked', voided: 'Voided' } as const;
	const printed = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
</script>

<svelte:head>
	<title>{data.title}</title>
	<style>
		@page {
			size: A4 landscape;
			margin: 12mm;
		}
	</style>
</svelte:head>

<div class="mx-auto flex max-w-5xl justify-end p-4 print:hidden">
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

<article class="mx-auto my-4 max-w-5xl bg-white p-8 text-sm text-ink shadow-sm print:my-0 print:shadow-none">
	<header class="flex items-start justify-between border-b border-ink/30 pb-4">
		<div>
			{#if data.logoUrl}<img src={data.logoUrl} alt="" class="mb-2 h-12 w-auto max-w-48 object-contain" />{/if}
			<h1 class="text-xl font-semibold">{data.company}</h1>
			<p class="text-ink-muted">{data.title}{data.query ? ` · matching "${data.query}"` : ''}</p>
		</div>
		<p class="text-right text-ink-muted">Printed {printed}</p>
	</header>

	<table class="mt-4 w-full border-collapse">
		<thead>
			<tr class="border-b border-ink/30 text-left">
				<th class="py-1.5">Employee</th>
				<th>Item</th>
				<th>Type</th>
				<th>Applies</th>
				<th class="text-right">Amount</th>
				<th class="pl-4">Status</th>
			</tr>
		</thead>
		<tbody>
			{#each data.items as i (i.id)}
				<tr class="border-b border-dotted border-ink/25 align-top">
					<td class="py-1.5">{i.employeeName} <span class="text-ink-muted">#{i.employeeNo}</span></td>
					<td>{i.label}</td>
					<td>{i.kind === 'earning' ? 'Earning' : 'Deduction'} · {CATEGORY_LABEL[i.category] ?? i.category}</td>
					<td>{when(i)}</td>
					<td class="text-right tabular-nums">{i.kind === 'deduction' ? '−' : ''}{money(i.amountCentavos)}</td>
					<td class="pl-4">{STATUS[i.status]}</td>
				</tr>
			{:else}
				<tr><td colspan="6" class="py-6 text-center text-ink-muted">No pay items match.</td></tr>
			{/each}
		</tbody>
		{#if data.items.length > 0}
			<tfoot>
				<tr class="font-medium">
					<td colspan="4" class="pt-3 text-right">Earnings</td>
					<td class="pt-3 text-right tabular-nums">{money(data.earnings)}</td>
					<td></td>
				</tr>
				<tr class="font-medium">
					<td colspan="4" class="text-right">Deductions</td>
					<td class="text-right tabular-nums">−{money(data.deductions)}</td>
					<td></td>
				</tr>
			</tfoot>
		{/if}
	</table>
</article>
