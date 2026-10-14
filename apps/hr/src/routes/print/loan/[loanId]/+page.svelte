<script lang="ts">
	import { money } from '$lib/components/payroll/money';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATUS = { active: 'Active', paused: 'Paused', paid_off: 'Paid off', cancelled: 'Cancelled' } as const;
	const monthLabel = (ym: string) =>
		new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
</script>

<svelte:head><title>Loan statement · {data.employee.name}</title></svelte:head>

<div class="mx-auto flex max-w-3xl justify-end p-4 print:hidden">
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

<article class="mx-auto my-4 max-w-3xl bg-white p-8 text-sm text-ink shadow-sm print:my-0 print:shadow-none">
	<header class="flex items-start justify-between border-b border-ink/30 pb-4">
		<div>
			{#if data.logoUrl}<img src={data.logoUrl} alt="" class="mb-2 h-12 w-auto max-w-48 object-contain" />{/if}
			<h1 class="text-xl font-semibold">{data.company}</h1>
			<p class="text-ink-muted">Loan statement of account</p>
		</div>
		<div class="text-right">
			<p class="text-lg font-semibold">{data.employee.name}</p>
			<p class="text-ink-muted tabular-nums">#{data.employee.no} · as of {data.asOf}</p>
		</div>
	</header>

	<dl class="mt-4 grid grid-cols-2 gap-x-8 gap-y-1">
		<div class="flex justify-between"><dt class="text-ink-muted">Loan</dt><dd>{data.loan.kindLabel}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Reference</dt><dd>{data.loan.referenceNo ?? '—'}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Total to pay back</dt><dd class="tabular-nums">{money(data.loan.principal)}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Per month</dt><dd class="tabular-nums">{money(data.loan.amortization)}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">First deducted</dt><dd>{monthLabel(data.loan.startPeriod)}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Released</dt><dd>{data.loan.releasedOn ?? '—'}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Term</dt><dd>{data.loan.termMonths ? `${data.loan.termMonths} months` : '—'}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Status</dt><dd>{STATUS[data.loan.status as keyof typeof STATUS] ?? data.loan.status}</dd></div>
	</dl>

	<table class="mt-6 w-full border-collapse">
		<thead>
			<tr class="border-b border-ink/30 text-left">
				<th class="py-1.5">Date</th>
				<th>Entry</th>
				<th class="text-right">Amount</th>
				<th class="text-right">Balance</th>
			</tr>
		</thead>
		<tbody>
			<tr class="border-b border-ink/10">
				<td class="py-1.5">—</td>
				<td>Total to pay back{data.loan.alreadyPaid > 0 ? `, less ${money(data.loan.alreadyPaid)} paid before this system` : ''}</td>
				<td></td>
				<td class="text-right tabular-nums">{money(data.loan.principal - data.loan.alreadyPaid)}</td>
			</tr>
			{#each data.rows as r, i (i)}
				<tr class="border-b border-ink/10">
					<td class="py-1.5 tabular-nums">{r.date}</td>
					<td>{r.label}{r.note ? ` — ${r.note}` : ''}</td>
					<td class="text-right tabular-nums">− {money(r.amount)}</td>
					<td class="text-right tabular-nums">{money(r.balance)}</td>
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr class="font-semibold">
				<td class="py-2" colspan="3">Balance still owed</td>
				<td class="text-right tabular-nums">{money(data.balance)}</td>
			</tr>
		</tfoot>
	</table>

	<p class="mt-6 text-xs text-ink-muted">
		Payroll deductions are listed only once their payslip is locked.
		{data.voided > 0 ? `${data.voided} voided payment${data.voided === 1 ? ' is' : 's are'} not shown.` : ''}
		{data.loan.statusNote ? `${STATUS[data.loan.status as keyof typeof STATUS] ?? ''}: ${data.loan.statusNote}` : ''}
	</p>
</article>
