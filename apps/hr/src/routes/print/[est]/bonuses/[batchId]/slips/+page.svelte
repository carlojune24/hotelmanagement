<script lang="ts">
	import { money } from '$lib/components/payroll/money';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const thirteenth = $derived(data.batch.kind !== 'other');
</script>

<svelte:head>
	<title>Bonus slips · {data.establishment} · {data.batch.label}</title>
	<style>
		@page {
			size: A4 portrait;
			margin: 12mm;
		}
	</style>
</svelte:head>

<div class="mx-auto flex max-w-3xl justify-end gap-2 p-4 print:hidden">
	<a
		href="/print/{data.slug}/bonuses/{data.batch.id}"
		class="rounded-full border border-ink/30 bg-white px-5 py-2 text-sm font-medium">Register</a
	>
	<button class="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground" onclick={() => window.print()}>
		Print / save as PDF
	</button>
</div>

{#if data.lines.length === 0}
	<p class="mx-auto max-w-3xl p-8 text-sm text-ink-muted">Nobody is paid in this batch.</p>
{/if}

<!-- Two slips to a page, each a self-contained half so it can be cut and handed over. -->
<div class="mx-auto max-w-3xl space-y-6 print:max-w-none print:space-y-0">
	{#each data.lines as l (l.id)}
		<article class="break-inside-avoid border border-ink/30 bg-white p-6 text-sm text-ink print:mb-8 print:border-dashed">
			{#if data.draft}
				<p class="mb-2 text-center text-[10px] tracking-wide uppercase text-ink-muted">Draft — not issued</p>
			{/if}
			<header class="flex items-start justify-between border-b border-ink/30 pb-2">
				<div>
					<p class="font-semibold">{data.company.name}</p>
					<p class="text-xs text-ink-muted">{data.establishment}</p>
				</div>
				<div class="text-right">
					<p class="font-semibold tracking-wide uppercase">Bonus slip</p>
					<p class="text-xs">{data.batch.label}</p>
					<p class="text-xs text-ink-muted tabular-nums">{data.batch.issuedOn ?? `Year ${data.batch.year}`}</p>
				</div>
			</header>

			<dl class="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
				<div class="flex justify-between"><dt class="text-ink-muted">Employee</dt><dd class="font-medium">{l.employeeName}</dd></div>
				<div class="flex justify-between"><dt class="text-ink-muted">No.</dt><dd class="tabular-nums">#{l.employeeNo}</dd></div>
				<div class="flex justify-between"><dt class="text-ink-muted">Position</dt><dd>{l.position ?? '—'}</dd></div>
			</dl>

			<table class="mt-3 w-full text-xs">
				<tbody>
					{#if thirteenth}
						<tr class="border-b border-ink/10"><td class="py-1">Basic salary earned</td><td class="text-right tabular-nums">{money(l.basicEarned)}</td></tr>
						{#if l.late > 0}
							<tr class="border-b border-ink/10"><td class="py-1">Less late / undertime</td><td class="text-right tabular-nums">− {money(l.late)}</td></tr>
						{/if}
						<tr class="border-b border-ink/10"><td class="py-1">13th month (÷ 12)</td><td class="text-right tabular-nums">{money(l.accrued)}</td></tr>
						{#if l.alreadyPaid > 0}
							<tr class="border-b border-ink/10"><td class="py-1">Less already paid</td><td class="text-right tabular-nums">− {money(l.alreadyPaid)}</td></tr>
						{/if}
					{/if}
					<tr class="font-semibold"><td class="py-2">Amount received</td><td class="text-right tabular-nums">{money(l.amount)}</td></tr>
				</tbody>
			</table>

			<div class="mt-8 grid grid-cols-2 gap-10 text-center text-xs text-ink-muted">
				<div class="border-t border-ink/50 pt-1">Employee signature</div>
				<div class="border-t border-ink/50 pt-1">Released by</div>
			</div>
		</article>
	{/each}
</div>
