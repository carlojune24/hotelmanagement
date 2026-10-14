<script lang="ts">
	import AdjustDialog from '$lib/components/payroll/adjust-dialog.svelte';
	import BatchActions from '$lib/components/payroll/batch-actions.svelte';
	import BatchStatus from '$lib/components/payroll/batch-status.svelte';
	import BatchTable from '$lib/components/payroll/batch-table.svelte';
	import { createRunner } from '$lib/components/payroll/runner.svelte';
	import type { LineView } from '$lib/server/hr/payroll-view';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let editing = $state<LineView | null>(null);
	const runner = createRunner(() => (editing = null));
	const ratesOk = $derived(data.run.ratesCheckedAt !== null);
	const b = $derived(data.batch);
</script>

<svelte:head><title>{b.establishmentName} · Payroll {data.run.cutoffStart} · HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div>
		<p class="text-sm text-ink-muted">
			<a href="/payroll" class="underline-offset-4 hover:underline">Payroll</a>
			<span aria-hidden="true"> › </span>
			<a href="/payroll/{data.run.id}" class="underline-offset-4 tabular-nums hover:underline">
				{data.run.cutoffStart} → {data.run.cutoffEnd}
			</a>
		</p>
		<h1 class="text-4xl font-light tracking-tight">{b.establishmentName}</h1>
	</div>

	<section class="panel space-y-4 p-5" aria-label={b.establishmentName}>
		<div class="flex flex-wrap items-start justify-between gap-3">
			<BatchStatus {b} />
			<div class="flex flex-wrap gap-2">
				<BatchActions {b} runId={data.run.id} {ratesOk} busy={runner.busy} run={runner.run} />
			</div>
		</div>

		{#if !ratesOk && b.status === 'draft'}
			<p class="text-sm text-ink-muted">
				The rates in force have not been confirmed for this run, so this batch cannot be locked yet.
				<a href="/payroll/{data.run.id}" class="font-medium text-ink underline underline-offset-4">Confirm them on the run page</a>.
			</p>
		{/if}

		<BatchTable {b} onadjust={(l) => (editing = l)} />
	</section>
</div>

<AdjustDialog line={editing} busy={runner.busy} run={runner.run} onclose={() => (editing = null)} />
