<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const money = (c: number) =>
		new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(c / 100);
	const hrs = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
	const basisLabel = (b: string) => (b === 'monthly' ? 'per month' : b === 'daily' ? 'per day' : 'per hour');

	const earningRows = $derived(
		[
			['Basic pay', data.earnings.basic],
			['Overtime', data.earnings.overtime],
			['Holiday / rest-day premium', data.earnings.holiday_premium],
			['Night differential', data.earnings.night_diff],
			['Allowances', data.earnings.allowances],
			['Other earnings', data.earnings.other]
		].filter(([, v]) => (v as number) > 0) as Array<[string, number]>
	);
	const deductionRows = $derived(
		[
			['SSS', data.deductions.sss_ee],
			['PhilHealth', data.deductions.philhealth_ee],
			['Pag-IBIG', data.deductions.pagibig_ee],
			['Withholding tax', data.deductions.withholding_tax],
			['Late / undertime', data.deductions.tardiness_undertime],
			['Cash advance', data.deductions.cash_advance],
			['Loans', data.deductions.loans],
			['Other deductions', data.deductions.other]
		].filter(([, v]) => (v as number) > 0) as Array<[string, number]>
	);
</script>

<svelte:head><title>Payslip · {data.employee.name}</title></svelte:head>

<div class="screen-only mx-auto flex max-w-3xl justify-end p-4 print:hidden">
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

<article class="slip mx-auto my-4 max-w-3xl bg-white p-8 text-sm text-ink shadow-sm print:my-0 print:shadow-none">
	{#if data.draft}
		<p class="mb-4 rounded border border-dashed border-ink/40 px-3 py-2 text-center text-xs tracking-wide uppercase">
			Draft — not yet released to the establishment
		</p>
	{/if}

	<header class="flex items-start justify-between border-b border-ink/30 pb-4">
		<div>
			<h1 class="text-xl font-semibold">{data.company.name}</h1>
			{#if data.company.address}<p class="text-ink-muted">{data.company.address}</p>{/if}
			<p class="text-ink-muted">{data.establishment}</p>
		</div>
		<div class="text-right">
			<p class="text-lg font-semibold tracking-wide uppercase">Payslip</p>
			<p class="tabular-nums">{data.period.start} – {data.period.end}</p>
			<p class="text-ink-muted tabular-nums">Pay date {data.period.payDate}</p>
		</div>
	</header>

	<section class="grid grid-cols-2 gap-x-8 gap-y-1 border-b border-ink/30 py-4">
		<p><span class="text-ink-muted">Employee</span> <strong class="font-medium">{data.employee.name}</strong></p>
		<p><span class="text-ink-muted">Employee #</span> {data.employee.no}</p>
		<p><span class="text-ink-muted">Position</span> {data.employee.position}</p>
		<p><span class="text-ink-muted">Department</span> {data.employee.department ?? '—'}</p>
		<p><span class="text-ink-muted">Rate</span> {money(data.basis.rate)} {basisLabel(data.basis.payBasis)}</p>
		<p>
			<span class="text-ink-muted">Time</span>
			{data.time.days} day{data.time.days === 1 ? '' : 's'} · {hrs(data.time.regularMinutes)}
			{#if data.time.otMinutes > 0}· OT {hrs(data.time.otMinutes)}{/if}
		</p>
	</section>

	<section class="grid grid-cols-2 gap-8 py-4">
		<div>
			<h2 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Earnings</h2>
			<table class="w-full">
				<tbody>
					{#each earningRows as [label, amount] (label)}
						<tr><td class="py-0.5">{label}</td><td class="py-0.5 text-right tabular-nums">{money(amount)}</td></tr>
					{/each}
					<tr class="border-t border-ink/30 font-medium">
						<td class="pt-1">Gross pay</td><td class="pt-1 text-right tabular-nums">{money(data.gross)}</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div>
			<h2 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Deductions</h2>
			<table class="w-full">
				<tbody>
					{#each deductionRows as [label, amount] (label)}
						<tr><td class="py-0.5">{label}</td><td class="py-0.5 text-right tabular-nums">{money(amount)}</td></tr>
					{:else}
						<tr><td class="py-0.5 text-ink-muted">None</td><td></td></tr>
					{/each}
					<tr class="border-t border-ink/30 font-medium">
						<td class="pt-1">Total deductions</td>
						<td class="pt-1 text-right tabular-nums">{money(data.gross - data.net)}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<section class="flex items-baseline justify-between rounded bg-gold/70 px-4 py-3 print:bg-transparent print:ring-1 print:ring-ink">
		<span class="text-base font-medium">Net pay</span>
		<span class="text-2xl font-semibold tabular-nums">{money(data.net)}</span>
	</section>

	{#if data.notCovered.length > 0}
		<p class="mt-2 text-xs text-ink-muted">Not covered / exempt: {data.notCovered.join(', ')}.</p>
	{/if}

	<footer class="mt-6 space-y-1 text-xs text-ink-muted">
		<p>
			SSS {data.employee.sss} · PhilHealth {data.employee.philhealth} · Pag-IBIG {data.employee.pagibig} · TIN {data.employee.tin}
		</p>
		<p>Government numbers are masked. This payslip is computer-generated.</p>
	</footer>
</article>

<style>
	@media print {
		:global(body) {
			background: white !important;
		}
	}
</style>
