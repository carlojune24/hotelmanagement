<script lang="ts">
	import { amt, money } from '$lib/components/payroll/money';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const showExtras = $derived(data.lines.some((l) => l.extras > 0));
	const keys = [
		'basic', 'overtime', 'premium', 'extras', 'gross', 'sss', 'philhealth', 'pagibig', 'tax',
		'lateUndertime', 'loanDeductions', 'cashAdvance', 'otherDeductions', 'net'
	] as const;
	const total = $derived(
		Object.fromEntries(keys.map((k) => [k, data.lines.reduce((t, l) => t + l[k], 0)])) as Record<(typeof keys)[number], number>
	);
	const incentiveCols = $derived(showExtras ? 3 : 2);
</script>

<svelte:head>
	<title>Payroll register · {data.establishment} · {data.period.start}</title>
	<style>
		@page {
			size: A4 landscape;
			margin: 10mm;
		}
	</style>
</svelte:head>

<div class="mx-auto flex max-w-[1200px] justify-end p-4 print:hidden">
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

<article class="mx-auto my-4 max-w-[1200px] bg-white p-8 text-xs text-ink shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none">
	{#if data.draft}
		<p class="mb-4 rounded border border-dashed border-ink/40 px-3 py-2 text-center text-xs tracking-wide uppercase">
			Draft — not final, not locked
		</p>
	{/if}

	<header class="flex items-start justify-between border-b border-ink/30 pb-3">
		<div>
			<h1 class="text-xl font-semibold">{data.company.name}</h1>
			{#if data.company.address}<p class="text-ink-muted">{data.company.address}</p>{/if}
			<p class="text-ink-muted">{data.establishment}</p>
		</div>
		<div class="text-right">
			<p class="text-lg font-semibold tracking-wide uppercase">Payroll register</p>
			<p class="tabular-nums">{data.period.start} → {data.period.end}</p>
			<p class="text-ink-muted tabular-nums">Pay date {data.period.payDate}</p>
		</div>
	</header>

	<table class="mt-3 w-full border-collapse text-[11px]">
		<thead>
			<tr class="text-center text-[10px] tracking-wide uppercase">
				<th rowspan="2" class="border-b border-ink/30 py-1 text-left align-bottom">Employee</th>
				<th rowspan="2" class="border-b border-ink/30 text-right align-bottom">Basic</th>
				<th colspan={incentiveCols} class="border-b border-ink/20 border-l">Incentives</th>
				<th rowspan="2" class="border-b border-ink/30 border-l text-right align-bottom">Gross</th>
				<th colspan="4" class="border-b border-ink/20 border-l">Government</th>
				<th colspan="4" class="border-b border-ink/20 border-l">Other deductions</th>
				<th rowspan="2" class="border-b border-ink/30 border-l text-right align-bottom">Net</th>
				<th rowspan="2" class="w-32 border-b border-ink/30 border-l align-bottom">Signature</th>
			</tr>
			<tr class="border-b border-ink/30 text-right">
				<th class="border-l py-1 font-medium">OT</th>
				<th class="font-medium">Premiums</th>
				{#if showExtras}<th class="font-medium">Allow.</th>{/if}
				<th class="border-l font-medium">SSS</th>
				<th class="font-medium">PhilHealth</th>
				<th class="font-medium">Pag-IBIG</th>
				<th class="font-medium">Tax</th>
				<th class="border-l font-medium">Late/UT</th>
				<th class="font-medium">Loans</th>
				<th class="font-medium">Cash adv.</th>
				<th class="font-medium">Other</th>
			</tr>
		</thead>
		<tbody>
			{#each data.lines as l (l.id)}
				<tr class="border-b border-ink/10 break-inside-avoid">
					<td class="py-2 pr-2">
						<span class="font-medium">{l.employeeName}</span>
						<span class="block text-ink-muted">#{l.employeeNo} · {l.position}</span>
					</td>
					<td class="text-right tabular-nums">{money(l.basic)}</td>
					<td class="border-l text-right tabular-nums">{amt(l.overtime)}</td>
					<td class="text-right tabular-nums">{amt(l.premium)}</td>
					{#if showExtras}<td class="text-right tabular-nums">{amt(l.extras)}</td>{/if}
					<td class="border-l text-right font-medium tabular-nums">{money(l.gross)}</td>
					<td class="border-l text-right tabular-nums">{amt(l.sss)}</td>
					<td class="text-right tabular-nums">{amt(l.philhealth)}</td>
					<td class="text-right tabular-nums">{amt(l.pagibig)}</td>
					<td class="text-right tabular-nums">{amt(l.tax)}</td>
					<td class="border-l text-right tabular-nums">{amt(l.lateUndertime)}</td>
					<td class="text-right tabular-nums">{amt(l.loanDeductions)}</td>
					<td class="text-right tabular-nums">{amt(l.cashAdvance)}</td>
					<td class="text-right tabular-nums">{amt(l.otherDeductions)}</td>
					<td class="border-l text-right font-medium tabular-nums">{money(l.net)}</td>
					<td class="border-l"></td>
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr class="border-t border-ink/40 font-semibold">
				<td class="py-2">Total · {data.lines.length} {data.lines.length === 1 ? 'payslip' : 'payslips'}</td>
				<td class="text-right tabular-nums">{money(total.basic)}</td>
				<td class="border-l text-right tabular-nums">{amt(total.overtime)}</td>
				<td class="text-right tabular-nums">{amt(total.premium)}</td>
				{#if showExtras}<td class="text-right tabular-nums">{amt(total.extras)}</td>{/if}
				<td class="border-l text-right tabular-nums">{money(total.gross)}</td>
				<td class="border-l text-right tabular-nums">{amt(total.sss)}</td>
				<td class="text-right tabular-nums">{amt(total.philhealth)}</td>
				<td class="text-right tabular-nums">{amt(total.pagibig)}</td>
				<td class="text-right tabular-nums">{amt(total.tax)}</td>
				<td class="border-l text-right tabular-nums">{amt(total.lateUndertime)}</td>
				<td class="text-right tabular-nums">{amt(total.loanDeductions)}</td>
				<td class="text-right tabular-nums">{amt(total.cashAdvance)}</td>
				<td class="text-right tabular-nums">{amt(total.otherDeductions)}</td>
				<td class="border-l text-right tabular-nums">{money(total.net)}</td>
				<td></td>
			</tr>
		</tfoot>
	</table>

	<div class="mt-10 grid grid-cols-3 gap-10 break-inside-avoid">
		{#each ['Prepared by', 'Checked by', 'Approved by'] as who (who)}
			<div class="border-t border-ink/50 pt-1 text-center text-ink-muted">{who}</div>
		{/each}
	</div>

	<p class="mt-6 text-[10px] text-ink-muted">
		Statutory contributions are computed from the rates on file and are not verified against the current circulars.
	</p>
</article>
