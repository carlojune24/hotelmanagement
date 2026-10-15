<script lang="ts">
	import { money } from '$lib/components/payroll/money';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATUS = { active: 'Active', paused: 'Paused', paid_off: 'Paid off', cancelled: 'Cancelled' } as const;
	const monthLabel = (ym: string) =>
		new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
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
				<th>Loan</th>
				<th>From</th>
				<th class="text-right">Per month</th>
				<th class="text-right">Principal</th>
				<th class="text-right">Paid</th>
				<th class="text-right">Balance</th>
				<th class="pl-4">Status</th>
			</tr>
		</thead>
		<tbody>
			{#each data.rows as l (l.id)}
				<tr class="border-b border-dotted border-ink/25 align-top">
					<td class="py-1.5">{l.employeeName} <span class="text-ink-muted">#{l.employeeNo}</span></td>
					<td>{l.kind}{#if l.referenceNo}<span class="text-ink-muted"> · ref {l.referenceNo}</span>{/if}</td>
					<td>{monthLabel(l.startPeriod)}</td>
					<td class="text-right tabular-nums">{money(l.amortization)}</td>
					<td class="text-right tabular-nums">{money(l.principal)}</td>
					<td class="text-right tabular-nums">{money(l.paid)}</td>
					<td class="text-right tabular-nums">{money(l.balance)}</td>
					<td class="pl-4">{STATUS[l.status]}</td>
				</tr>
			{:else}
				<tr><td colspan="8" class="py-6 text-center text-ink-muted">No loans match.</td></tr>
			{/each}
		</tbody>
		{#if data.rows.length > 0}
			<tfoot>
				<tr class="font-medium">
					<td colspan="4" class="pt-3 text-right">{data.rows.length} loans</td>
					<td class="pt-3 text-right tabular-nums">{money(data.principal)}</td>
					<td></td>
					<td class="pt-3 text-right tabular-nums">{money(data.balance)}</td>
					<td></td>
				</tr>
			</tfoot>
		{/if}
	</table>
</article>
