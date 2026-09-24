<script lang="ts">
	import { page } from '$app/state';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const base = $derived(`/${page.params.hotel}/management/finance/reports`);
	const kindHint: Record<string, string> = { day: 'single day', range: 'date range', asOf: 'as of a date' };

	// The accounting reports say what question they answer; the cash reports are self-explanatory.
	const question: Record<string, string> = {
		'trial-balance': 'Do the books add up, and does cash match the ledger?',
		'general-ledger': 'Why did this account move?',
		'income-statement': 'What did we earn and spend?',
		'balance-sheet': 'What do we hold and owe?'
	};

	const groups = $derived([
		{ title: 'Ledger', reports: data.reports.filter((r) => r.group === 'ledger') },
		{ title: 'Cash & sales', reports: data.reports.filter((r) => r.group === 'cash') }
	]);
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<h1 class="mb-4 text-xl font-semibold tracking-tight text-ink">Reports</h1>
	{#each groups as g (g.title)}
		<h2 class="mt-6 mb-2 text-sm font-semibold text-ink first:mt-0">{g.title}</h2>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each g.reports as r (r.slug)}
				<a href="{base}/{r.slug}" class="rounded-xl border border-border p-4 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
					<div class="font-medium text-ink">{r.name}</div>
					<div class="text-xs text-ink-muted">{question[r.slug] ?? kindHint[r.kind]}</div>
					{#if question[r.slug]}
						<div class="mt-0.5 text-xs text-ink-muted/80">{kindHint[r.kind]}</div>
					{/if}
				</a>
			{/each}
		</div>
	{/each}
</div>
