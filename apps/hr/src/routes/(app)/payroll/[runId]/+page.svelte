<script lang="ts">
	import { enhance } from '$app/forms';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import AdjustDialog from '$lib/components/payroll/adjust-dialog.svelte';
	import BatchActions from '$lib/components/payroll/batch-actions.svelte';
	import BatchStatus from '$lib/components/payroll/batch-status.svelte';
	import BatchTable from '$lib/components/payroll/batch-table.svelte';
	import CostCenterTable from '$lib/components/payroll/cost-center-table.svelte';
	import RatesGuide from '$lib/components/payroll/rates-guide.svelte';
	import { groupByCostCenter } from '$lib/cost-centers-core';
	import { createRunner } from '$lib/components/payroll/runner.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { LineView } from '$lib/server/hr/payroll-view';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let editing = $state<LineView | null>(null);
	const runner = createRunner(() => (editing = null));
	const ratesOk = $derived(data.run.ratesCheckedAt !== null);
	const costRows = $derived(groupByCostCenter(data.batches.flatMap((b) => b.lines)));
</script>

<svelte:head><title>Payroll {data.run.cutoffStart} · HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
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
		<div class="flex flex-wrap items-center gap-2">
			{#if ratesOk}
				<Badge variant="ok">Rates confirmed for this run</Badge>
			{:else}
				<form method="POST" action="?/confirmRates" use:enhance={runner.run}>
					<Button type="submit" variant="gold" size="sm" disabled={runner.busy}>I've checked these for this period</Button>
				</form>
			{/if}
			<RatesGuide rates={data.rates} />
		</div>
	</div>

	<section class="panel divide-y divide-dotted divide-ink/25 p-2" aria-label="Establishments">
		{#each data.batches as b (b.id)}
			{#snippet head()}
				<div class="min-w-0">
					<h2 class="flex items-center gap-2 text-xl font-light">
						{#if b.lines.length > 0}
							<ChevronDownIcon
								class="size-5 shrink-0 -rotate-90 text-ink-muted transition-transform group-open/batch:rotate-0"
								aria-hidden="true"
							/>
						{:else}
							<span class="size-5 shrink-0" aria-hidden="true"></span>
						{/if}
						{b.establishmentName}
					</h2>
					<div class="pl-7"><BatchStatus {b} /></div>
				</div>
				<div class="flex flex-wrap gap-2">
					<Button variant="ghost" href="/payroll/{data.run.id}/{b.id}">View</Button>
					<BatchActions {b} runId={data.run.id} {ratesOk} busy={runner.busy} run={runner.run} />
				</div>
			{/snippet}

			{#if b.lines.length > 0}
				<details class="group/batch px-3 py-3" open>
					<!-- Buttons inside a summary keep working; clicking the name or badges folds the table. -->
					<summary
						class="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 [&::-webkit-details-marker]:hidden"
					>
						{@render head()}
					</summary>
					<div class="mt-4 space-y-4">
						<BatchTable {b} onadjust={(l) => (editing = l)} />
					</div>
				</details>
			{:else}
				<div class="px-3 py-3">
					<div class="flex flex-wrap items-start justify-between gap-3">
						{@render head()}
					</div>
					<div class="mt-2 pl-7">
						<BatchTable {b} onadjust={(l) => (editing = l)} />
					</div>
				</div>
			{/if}
		{/each}
	</section>

	<CostCenterTable rows={costRows} />
</div>

<AdjustDialog line={editing} busy={runner.busy} run={runner.run} onclose={() => (editing = null)} />
