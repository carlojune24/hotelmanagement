<script lang="ts">
	import { money } from '$lib/components/payroll/money';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const credits = $derived(data.items.filter((i) => i.kind === 'credit'));
	const charges = $derived(data.items.filter((i) => i.kind === 'charge'));
	const settled = $derived(data.items.filter((i) => i.kind === 'receipt' || i.kind === 'writeoff'));
	const t = $derived(data.totals);
	const dayLabel = (d: Date | string) =>
		new Date(d).toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' });
</script>

<svelte:head>
	<title>Final pay and clearance · {data.employee.name}</title>
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

<article class="mx-auto my-4 max-w-3xl bg-white p-8 text-sm text-ink shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none">
	{#if data.status !== 'cleared'}
		<p class="mb-4 rounded border border-dashed border-ink/40 px-3 py-2 text-center text-xs tracking-wide uppercase">
			Not cleared{t.stillOwed > 0 ? ' — balance still owed' : ''}
		</p>
	{/if}

	<header class="flex items-start justify-between border-b border-ink/30 pb-3">
		<div>
			{#if data.logoUrl}<img src={data.logoUrl} alt="" class="mb-2 h-12 w-auto max-w-48 object-contain" />{/if}
			<h1 class="text-xl font-semibold">{data.company}</h1>
			<p class="text-ink-muted">Final pay and clearance statement</p>
		</div>
		<div class="text-right">
			<p class="text-lg font-semibold">{data.employee.name}</p>
			<p class="text-ink-muted tabular-nums">
				#{data.employee.no}{data.employee.position ? ` · ${data.employee.position}` : ''}
			</p>
			<p class="text-ink-muted">{data.employee.establishment ?? ''}</p>
		</div>
	</header>

	<dl class="mt-3 grid grid-cols-2 gap-x-8 gap-y-1">
		<div class="flex justify-between"><dt class="text-ink-muted">Reason</dt><dd>{data.kind}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">Last day</dt><dd class="tabular-nums">{data.lastDay}</dd></div>
		<div class="flex justify-between"><dt class="text-ink-muted">As of</dt><dd class="tabular-nums">{data.asOf}</dd></div>
		<div class="flex justify-between">
			<dt class="text-ink-muted">Status</dt>
			<dd>{data.status === 'cleared' ? `Cleared ${data.clearedAt ? dayLabel(data.clearedAt) : ''}` : 'In process'}</dd>
		</div>
	</dl>

	<h2 class="mt-5 border-b border-ink/30 pb-1 text-xs font-semibold tracking-wide uppercase">Owed to the employee</h2>
	<table class="w-full">
		<tbody>
			{#each credits as i (i.id)}
				{@const midYear = i.source === 'thirteenth_month' && data.thirteenth.midYearPaid > 0}
				<tr class="border-b border-ink/10">
					<td class="py-1.5">
						{i.label}{i.note && !midYear ? ` — ${i.note}` : ''}
						{#if midYear}
							<span class="block text-xs text-ink-muted tabular-nums">
								13th month {money(data.thirteenth.computed)}, less {money(data.thirteenth.midYearPaid)} already paid as a
								mid-year installment.
							</span>
						{/if}
					</td>
					<td class="text-right align-top tabular-nums">{money(i.amount)}</td>
				</tr>
			{:else}
				<tr><td class="py-1.5 text-ink-muted" colspan="2">None.</td></tr>
			{/each}
			<tr class="font-semibold"><td class="py-1.5">Total owed to the employee</td><td class="text-right tabular-nums">{money(t.credits)}</td></tr>
		</tbody>
	</table>

	<h2 class="mt-5 border-b border-ink/30 pb-1 text-xs font-semibold tracking-wide uppercase">Less: charges and loans taken from final pay</h2>
	<table class="w-full">
		<tbody>
			{#each charges as i (i.id)}
				<tr class="border-b border-ink/10">
					<td class="py-1.5">{i.label}{i.note ? ` — ${i.note}` : ''}</td>
					<td class="text-right tabular-nums">− {money(i.amount)}</td>
				</tr>
			{/each}
			{#each data.applied as a (a.id)}
				<tr class="border-b border-ink/10">
					<td class="py-1.5">{a.label}{a.referenceNo ? ` · ref ${a.referenceNo}` : ''} — applied {a.paidOn}</td>
					<td class="text-right tabular-nums">− {money(a.amount)}</td>
				</tr>
			{/each}
			{#if charges.length === 0 && data.applied.length === 0}
				<tr><td class="py-1.5 text-ink-muted" colspan="2">None.</td></tr>
			{/if}
		</tbody>
	</table>

	<table class="mt-3 w-full">
		<tbody>
			<tr class="border-t border-ink/40 text-base font-semibold">
				<td class="py-2">Net final pay to the employee</td>
				<td class="text-right tabular-nums">{money(t.payToEmployee)}</td>
			</tr>
			{#if data.finalPayPaidOn}
				<tr><td class="text-xs text-ink-muted" colspan="2">Handed over on {data.finalPayPaidOn}</td></tr>
			{/if}
		</tbody>
	</table>

	<h2 class="mt-5 border-b border-ink/30 pb-1 text-xs font-semibold tracking-wide uppercase">Still owed to the company</h2>
	<table class="w-full">
		<tbody>
			{#each data.openLoans as l (l.id)}
				<tr class="border-b border-ink/10">
					<td class="py-1.5">{l.label}{l.referenceNo ? ` · ref ${l.referenceNo}` : ''} — remaining balance</td>
					<td class="text-right tabular-nums">{money(l.balance)}</td>
				</tr>
			{/each}
			{#if t.nonLoanOwed > 0}
				<tr class="border-b border-ink/10">
					<td class="py-1.5">Charges not covered by final pay</td>
					<td class="text-right tabular-nums">{money(t.nonLoanOwed)}</td>
				</tr>
			{/if}
			{#each settled as i (i.id)}
				<tr class="border-b border-ink/10 text-ink-muted">
					<td class="py-1.5">{i.label} <span class="text-xs">({i.kindLabel})</span></td>
					<td class="text-right tabular-nums">{money(i.amount)}</td>
				</tr>
			{/each}
			<tr class="font-semibold">
				<td class="py-1.5">Total still owed</td>
				<td class="text-right tabular-nums">{money(t.stillOwed)}</td>
			</tr>
		</tbody>
	</table>

	<h2 class="mt-5 border-b border-ink/30 pb-1 text-xs font-semibold tracking-wide uppercase">Clearance</h2>
	<ul class="mt-1">
		{#each data.clearance as c (c.id)}
			<li class="flex items-center justify-between border-b border-ink/10 py-1.5">
				<span class="flex items-center gap-2">
					<span class="inline-block size-3.5 border border-ink/60 text-center text-[10px] leading-3.5">{c.doneAt ? '✓' : ''}</span>
					{c.label}
				</span>
				<span class="text-xs text-ink-muted tabular-nums">{c.doneAt ? dayLabel(c.doneAt) : ''}</span>
			</li>
		{/each}
	</ul>

	<div class="mt-12 grid grid-cols-3 gap-8 break-inside-avoid text-center text-xs text-ink-muted">
		<div class="border-t border-ink/50 pt-1">Employee — received the above</div>
		<div class="border-t border-ink/50 pt-1">Prepared by</div>
		<div class="border-t border-ink/50 pt-1">Approved by</div>
	</div>

	{#if data.note}
		<p class="mt-6 text-xs text-ink-muted">Note: {data.note}</p>
	{/if}
</article>
