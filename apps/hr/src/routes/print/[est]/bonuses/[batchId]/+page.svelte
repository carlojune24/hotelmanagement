<script lang="ts">
	import { money } from '$lib/components/payroll/money';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const thirteenth = $derived(data.batch.kind !== 'other');
	const sum = (k: 'basicEarned' | 'late' | 'accrued' | 'alreadyPaid' | 'amount') => data.lines.reduce((t, l) => t + l[k], 0);
</script>

<svelte:head>
	<title>Bonus register · {data.establishment} · {data.batch.label}</title>
	<style>
		@page {
			size: A4 landscape;
			margin: 10mm;
		}
	</style>
</svelte:head>

<div class="mx-auto flex max-w-[1100px] justify-end gap-2 p-4 print:hidden">
	<a
		href="/print/{data.slug}/bonuses/{data.batch.id}/slips"
		class="rounded-full border border-ink/30 bg-white px-5 py-2 text-sm font-medium"
		>Bonus slips</a
	>
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

<article class="mx-auto my-4 max-w-[1100px] bg-white p-8 text-xs text-ink shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none">
	{#if data.draft}
		<p class="mb-4 rounded border border-dashed border-ink/40 px-3 py-2 text-center text-xs tracking-wide uppercase">
			Draft — not issued
		</p>
	{/if}

	<header class="flex items-start justify-between border-b border-ink/30 pb-3">
		<div>
			{#if data.logoUrl}<img src={data.logoUrl} alt="" class="mb-2 h-12 w-auto max-w-48 object-contain" />{/if}
			<h1 class="text-xl font-semibold">{data.company.name}</h1>
			{#if data.company.address}<p class="text-ink-muted">{data.company.address}</p>{/if}
			<p class="text-ink-muted">{data.establishment}</p>
		</div>
		<div class="text-right">
			<p class="text-lg font-semibold tracking-wide uppercase">Bonus register</p>
			<p>{data.batch.label}</p>
			<p class="text-ink-muted tabular-nums">
				{#if data.batch.issuedOn}Issued {data.batch.issuedOn}{:else}Year {data.batch.year}{/if}
			</p>
		</div>
	</header>

	<table class="mt-3 w-full border-collapse text-[11px]">
		<thead>
			<tr class="border-b border-ink/30 text-right">
				<th class="py-1.5 text-left">Employee</th>
				{#if thirteenth}
					<th>Basic earned</th>
					<th>Late / UT</th>
					<th>13th month (÷ 12)</th>
					<th>Already paid</th>
				{/if}
				<th>{thirteenth ? 'Amount paid' : 'Amount'}</th>
				<th class="w-40 text-left pl-3">Signature</th>
			</tr>
		</thead>
		<tbody>
			{#each data.lines as l (l.id)}
				<tr class="border-b border-ink/10 break-inside-avoid">
					<td class="py-2 pr-2">
						<span class="font-medium">{l.employeeName}</span>
						<span class="block text-ink-muted">#{l.employeeNo}{l.position ? ` · ${l.position}` : ''}</span>
						{#if l.taxable > 0}<span class="block font-medium">Taxable portion {money(l.taxable)}</span>{/if}
					</td>
					{#if thirteenth}
						<td class="text-right tabular-nums">{money(l.basicEarned)}</td>
						<td class="text-right tabular-nums">{l.late > 0 ? money(l.late) : '–'}</td>
						<td class="text-right tabular-nums">{money(l.accrued)}</td>
						<td class="text-right tabular-nums">{l.alreadyPaid > 0 ? money(l.alreadyPaid) : '–'}</td>
					{/if}
					<td class="text-right font-medium tabular-nums">{money(l.amount)}</td>
					<td class="border-l pl-3"></td>
				</tr>
			{/each}
		</tbody>
		<tfoot>
			<tr class="border-t border-ink/40 font-semibold">
				<td class="py-2">Total · {data.lines.length} {data.lines.length === 1 ? 'person' : 'people'}</td>
				{#if thirteenth}
					<td class="text-right tabular-nums">{money(sum('basicEarned'))}</td>
					<td class="text-right tabular-nums">{money(sum('late'))}</td>
					<td class="text-right tabular-nums">{money(sum('accrued'))}</td>
					<td class="text-right tabular-nums">{money(sum('alreadyPaid'))}</td>
				{/if}
				<td class="text-right tabular-nums">{money(sum('amount'))}</td>
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
		{thirteenth
			? '13th month pay under Presidential Decree 851: one twelfth of basic salary earned in the year, excluding overtime, premiums and allowances.'
			: ''}
		The 13th month and other benefits are exempt from income tax up to ₱90,000 a year; any excess is taxable.
		{#if data.lines.some((l) => l.taxable > 0)}
			Taxable portion on this register: {money(data.lines.reduce((t, l) => t + l.taxable, 0))}. It is not withheld here.
		{/if}
	</p>
</article>
