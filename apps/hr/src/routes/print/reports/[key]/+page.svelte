<script lang="ts">
	import { money } from '$lib/components/payroll/money';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const printed = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
	const cell = (v: string | number, money_: boolean) => (money_ && typeof v === 'number' ? money(v) : v);
</script>

<svelte:head>
	<title>{data.doc.title} · {data.doc.period}</title>
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

<article class="mx-auto my-4 max-w-5xl bg-white p-8 text-sm text-ink shadow-sm print:my-0 print:max-w-none print:shadow-none">
	<header class="flex items-start justify-between border-b border-ink/30 pb-4">
		<div>
			{#if data.logoUrl}<img src={data.logoUrl} alt="" class="mb-2 h-12 w-auto max-w-48 object-contain" />{/if}
			<h1 class="text-xl font-semibold">{data.company}</h1>
			<p class="text-ink-muted">{data.doc.title} · {data.doc.period}</p>
			<p class="text-ink-muted">{data.scope}</p>
		</div>
		<p class="text-ink-muted">Printed {printed}</p>
	</header>

	<dl class="mt-4 flex flex-wrap gap-x-10 gap-y-2">
		{#each data.doc.stats as s (s.label)}
			<div>
				<dt class="text-xs text-ink-muted">{s.label}</dt>
				<dd class="text-lg font-semibold tabular-nums">{s.money ? money(s.raw ?? 0) : s.value}</dd>
			</div>
		{/each}
	</dl>
	{#each data.doc.notes as n (n)}<p class="mt-2 text-xs text-ink-muted">{n}</p>{/each}

	{#each data.doc.sections as sec (sec.title)}
		<section class="mt-6 break-inside-avoid-page">
			<h2 class="mb-1 font-semibold">{sec.title}</h2>
			<table class="w-full border-collapse">
				<thead>
					<tr class="border-b border-ink/30 text-left text-xs text-ink-muted">
						{#each sec.head as h, i (i)}
							<th class="py-1 font-normal {sec.numCols?.includes(i) ? 'text-right' : ''}">{h}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each sec.rows as row, ri (ri)}
						<tr class="border-b border-ink/10">
							{#each row as v, i (i)}
								<td class="py-1 {sec.numCols?.includes(i) ? 'text-right tabular-nums' : ''}">{cell(v, !!sec.moneyCols?.includes(i))}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/each}
</article>
