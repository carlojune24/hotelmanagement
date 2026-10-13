<script lang="ts">
	import { enhance } from '$app/forms';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import AdjustDialog from '$lib/components/payroll/adjust-dialog.svelte';
	import BatchActions from '$lib/components/payroll/batch-actions.svelte';
	import BatchStatus from '$lib/components/payroll/batch-status.svelte';
	import BatchTable from '$lib/components/payroll/batch-table.svelte';
	import { createRunner } from '$lib/components/payroll/runner.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { LineView } from '$lib/server/hr/payroll-view';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let editing = $state<LineView | null>(null);
	const runner = createRunner(() => (editing = null));
	const ratesOk = $derived(data.run.ratesCheckedAt !== null);
</script>

<svelte:head><title>Payroll {data.run.cutoffStart} · HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div>
		<p class="text-sm text-ink-muted"><a href="/payroll" class="underline-offset-4 hover:underline">Payroll</a></p>
		<h1 class="text-4xl font-light tracking-tight tabular-nums">
			{data.run.cutoffStart} → {data.run.cutoffEnd}
		</h1>
		<p class="mt-1 text-sm text-ink-muted">
			Pay date {data.run.payDate} · {data.run.frequency === 'monthly' ? 'monthly' : 'twice a month'} ·
			{data.run.dayFactor}-day factor. One payslip per person, listed under their home establishment.
		</p>
	</div>

	<section class="panel space-y-3 p-5" aria-label="Statutory rates">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-xl font-light">Rates in force</h2>
			{#if ratesOk}
				<Badge variant="ok">Confirmed for this run</Badge>
			{:else}
				<form method="POST" action="?/confirmRates" use:enhance={runner.run}>
					<Button type="submit" variant="gold" disabled={runner.busy}>I've checked these for this period</Button>
				</form>
			{/if}
		</div>
		<!-- Open until someone confirms, so the figures being confirmed are in view. -->
		<details class="group space-y-3" open={!ratesOk}>
			<summary
				class="cursor-pointer text-sm font-medium underline-offset-4 select-none hover:underline group-open:mb-3"
			>
				<span class="group-open:hidden">Show the {data.rates.length} rates</span>
				<span class="hidden group-open:inline">Hide the rates</span>
			</summary>
			<p class="text-sm text-ink-muted">
				These are the published figures this system applies. They are not fetched live — check them
				against the current SSS, PhilHealth, Pag-IBIG and BIR issuances before locking any batch.
			</p>
			<ul class="grid gap-1 text-sm sm:grid-cols-2">
				{#each data.rates as r (r.name)}
					<li class="rounded-xl bg-white/70 px-3 py-2">
						<span class="font-medium">{r.name}</span> — {r.rule}
						<span class="text-xs text-ink-muted"> (since {r.since})</span>
					</li>
				{/each}
			</ul>
		</details>
	</section>

	{#each data.batches as b (b.id)}
		<section class="panel p-5" aria-label={b.establishmentName}>
			<details class="group/batch" open>
				<!-- Buttons inside a summary keep working; clicking the name or badges folds the table. -->
				<summary
					class="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 [&::-webkit-details-marker]:hidden"
				>
					<div>
						<h2 class="flex items-center gap-2 text-2xl font-light">
							<ChevronDownIcon
								class="size-5 shrink-0 -rotate-90 text-ink-muted transition-transform group-open/batch:rotate-0"
								aria-hidden="true"
							/>
							{b.establishmentName}
						</h2>
						<BatchStatus {b} />
					</div>
					<div class="flex flex-wrap gap-2">
						<Button variant="ghost" href="/payroll/{data.run.id}/{b.id}">View</Button>
						<BatchActions {b} runId={data.run.id} {ratesOk} busy={runner.busy} run={runner.run} />
					</div>
				</summary>

				<div class="mt-4 space-y-4">
					<BatchTable {b} onadjust={(l) => (editing = l)} />
				</div>
			</details>
		</section>
	{/each}
</div>

<AdjustDialog line={editing} busy={runner.busy} run={runner.run} onclose={() => (editing = null)} />
