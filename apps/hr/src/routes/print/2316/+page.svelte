<script lang="ts">
	import { money } from '$lib/components/payroll/money';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const day = (d: string) =>
		new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
</script>

<svelte:head>
	<title>BIR 2316 data {data.year}</title>
	<style>
		@page {
			size: A4 portrait;
			margin: 14mm;
		}
	</style>
</svelte:head>

<div class="mx-auto flex max-w-3xl justify-end p-4 print:hidden">
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

{#if data.drafts > 0}
	<p class="mx-auto my-2 max-w-3xl rounded-xl border border-dashed border-danger/50 px-4 py-2 text-sm text-danger">
		{data.drafts} draft payroll {data.drafts === 1 ? 'batch' : 'batches'} paid in {data.year} {data.drafts === 1 ? 'is' : 'are'}
		not locked, so these sheets are incomplete. Lock the year's payrolls and the settlement before using them.
	</p>
{/if}

{#each data.rows as r (r.employeeId)}
	{@const withheld = r.withheld + r.prevWithheld}
	{@const nonTaxable = r.benefitsExempt + r.exemptEarnings + r.contributions}
	<article class="mx-auto my-4 max-w-3xl break-after-page bg-white p-8 text-sm text-ink shadow-sm print:my-0 print:shadow-none">
		<header class="border-b border-ink/30 pb-3">
			<h1 class="text-lg font-semibold">Certificate of compensation payment / tax withheld</h1>
			<p class="text-ink-muted">For the year {data.year} · BIR Form 2316 data sheet</p>
		</header>

		<section class="mt-4 grid grid-cols-2 gap-x-8 gap-y-2">
			<div><p class="text-xs text-ink-muted">Employee</p><p class="font-medium">{r.lastName}, {r.firstName} {r.middleName}</p></div>
			<div><p class="text-xs text-ink-muted">TIN</p><p class="font-medium tabular-nums">{r.tin || 'Not on file'}</p></div>
			<div class="col-span-2"><p class="text-xs text-ink-muted">Home address</p><p>{r.address || 'Not on file'}</p></div>
			<div><p class="text-xs text-ink-muted">Date of birth</p><p>{day(r.birthdate)}</p></div>
			<div><p class="text-xs text-ink-muted">Employee no.</p><p>{r.employeeNo}</p></div>
			<div><p class="text-xs text-ink-muted">Employer</p><p class="font-medium">{data.employer.name}</p></div>
			<div><p class="text-xs text-ink-muted">Employer TIN</p><p class="tabular-nums">{data.employer.tin || 'Not on file'}</p></div>
		</section>

		<table class="mt-6 w-full border-collapse">
			<tbody>
				<tr class="border-b border-ink/15"><td class="py-1.5">Gross compensation income (basic, overtime, premiums, allowances)</td><td class="text-right tabular-nums">{money(r.gross)}</td></tr>
				<tr class="border-b border-ink/15"><td class="py-1.5">13th month pay and other benefits</td><td class="text-right tabular-nums">{money(r.benefits)}</td></tr>
				<tr class="border-b border-ink/15 text-ink-muted"><td class="py-1.5 pl-4">Of which exempt (up to ₱90,000)</td><td class="text-right tabular-nums">{money(r.benefitsExempt)}</td></tr>
				<tr class="border-b border-ink/15 text-ink-muted"><td class="py-1.5 pl-4">Exempt earnings (de minimis and similar)</td><td class="text-right tabular-nums">{money(r.exemptEarnings)}</td></tr>
				<tr class="border-b border-ink/15 text-ink-muted"><td class="py-1.5 pl-4">SSS, PhilHealth and Pag-IBIG contributions (employee share)</td><td class="text-right tabular-nums">{money(r.contributions)}</td></tr>
				<tr class="border-b border-ink/15"><td class="py-1.5">Total non-taxable</td><td class="text-right tabular-nums">{money(nonTaxable)}</td></tr>
				<tr class="border-b border-ink/15"><td class="py-1.5">Taxable compensation, this employer</td><td class="text-right tabular-nums">{money(r.basicTaxable + r.benefitsTaxable)}</td></tr>
				{#if r.prevTaxable > 0}
					<tr class="border-b border-ink/15"><td class="py-1.5">Taxable compensation, previous employer{r.prevEmployerName ? ` (${r.prevEmployerName})` : ''}</td><td class="text-right tabular-nums">{money(r.prevTaxable)}</td></tr>
				{/if}
				<tr class="border-b border-ink/15 font-medium"><td class="py-1.5">Total taxable compensation</td><td class="text-right tabular-nums">{money(r.taxable)}</td></tr>
				<tr class="border-b border-ink/15"><td class="py-1.5">Tax due for the year</td><td class="text-right tabular-nums">{money(r.taxDue)}</td></tr>
				<tr class="border-b border-ink/15"><td class="py-1.5">Tax withheld{r.prevWithheld > 0 ? ' (this employer and previous employer)' : ''}</td><td class="text-right tabular-nums">{money(withheld)}</td></tr>
				<tr class="font-medium"><td class="py-2">{withheld - r.taxDue >= 0 ? 'Over-withheld' : 'Under-withheld'}</td><td class="text-right tabular-nums">{money(Math.abs(withheld - r.taxDue))}</td></tr>
			</tbody>
		</table>

		<div class="mt-12 grid grid-cols-2 gap-10 text-center text-xs text-ink-muted">
			<div class="border-t border-ink/50 pt-1">Employer / authorized representative</div>
			<div class="border-t border-ink/50 pt-1">Employee signature · date</div>
		</div>
		<p class="mt-6 text-[10px] text-ink-muted">
			Printed {day(data.printedOn)}. A data sheet of the figures for BIR Form 2316, not the official form; copy
			the figures to the current BIR form or the eBIRForms package and check them with your accountant.
		</p>
	</article>
{:else}
	<p class="p-8 text-center text-ink-muted">No employees with payslips in {data.year}.</p>
{/each}
