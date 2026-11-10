<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import OpenShiftCard from '$lib/components/staff/open-shift-card.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}/management/finance/shifts`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const fmt = (d: string | Date) =>
		new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
	const at = (d: string | Date | null) =>
		d
			? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: data.hotel?.timezone })
			: '—';

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

</script>

<div class="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6">
	<h1 class="mb-4 text-xl font-semibold tracking-tight text-ink">Cashier shifts</h1>

	{#each data.openReconciliations as r (r.shift.id)}
		<OpenShiftCard recon={r} expenseCategories={data.expenseCategories} />
	{/each}

	<div class="mb-2 mt-6 flex flex-wrap items-center justify-between gap-3">
		<h2 class="text-sm font-semibold text-ink">Shift history</h2>
		<div class="inline-flex rounded-lg border border-border bg-surface-2 p-1" role="group" aria-label="Source">
			{#each [['all', 'All'], ['hotel', 'Hotel'], ['dining', 'Dining']] as const as [v, label] (v)}
				<a
					href={v === 'hotel' ? page.url.pathname : `?src=${v}`}
					data-sveltekit-noscroll
					aria-current={data.side === v ? 'true' : undefined}
					class="min-w-20 rounded-md px-4 py-2 text-center text-sm font-semibold {data.side === v ? 'bg-background text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}"
				>{label}</a>
			{/each}
		</div>
	</div>
	<div class="overflow-x-auto rounded-xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Opened / by</Table.Head>
					<Table.Head>Closed / by</Table.Head>
					<Table.Head>Drawer</Table.Head>
					<Table.Head class="text-right">Opening</Table.Head>
					<Table.Head class="text-right">Expected</Table.Head>
					<Table.Head class="text-right">Counted</Table.Head>
					<Table.Head class="text-right">Variance</Table.Head>
					<Table.Head></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.shifts as s (s.id)}
					<Table.Row>
						<Table.Cell class="whitespace-nowrap text-ink-muted">
							{at(s.openedAt)}
							<div class="text-xs text-ink">{s.openedByName ?? '—'}</div>
						</Table.Cell>
						<Table.Cell class="whitespace-nowrap text-ink-muted">
							{at(s.closedAt)}
							{#if s.closedAt}<div class="text-xs text-ink">{s.closedByName ?? '—'}</div>{/if}
						</Table.Cell>
						<Table.Cell class="text-ink">{s.drawerName}</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ink-muted"
							>{peso(s.openingFloatCentavos)}</Table.Cell
						>
						<Table.Cell class="text-right tabular-nums text-ink-muted"
							>{s.expectedCashCentavos != null ? peso(s.expectedCashCentavos) : '—'}</Table.Cell
						>
						<Table.Cell class="text-right tabular-nums text-ink"
							>{s.countedCashCentavos != null ? peso(s.countedCashCentavos) : '—'}</Table.Cell
						>
						<Table.Cell
							class="text-right tabular-nums {s.varianceCentavos
								? s.varianceCentavos < 0
									? 'text-danger'
									: 'text-brand'
								: 'text-ink-muted'}"
						>
							{s.varianceCentavos != null ? peso(s.varianceCentavos) : '—'}
							{#if s.varianceChargebackStatus === 'owed'}
								<Badge variant="outline" class="ml-1.5 border-transparent bg-danger/15 text-danger">Owed</Badge>
							{:else if s.varianceChargebackStatus === 'collected'}
								<Badge variant="outline" class="ml-1.5 border-transparent bg-ok/15 text-ok">Recovered</Badge>
							{:else if s.varianceChargebackStatus === 'written_off'}
								<Badge variant="outline" class="ml-1.5 border-border bg-surface-2 text-ink-muted">Written off</Badge>
							{/if}
						</Table.Cell>
						<Table.Cell class="text-right"
							><a href="{base}/{s.id}" class="text-xs underline underline-offset-2">Details</a
							></Table.Cell
						>
					</Table.Row>
				{:else}
					<Table.Row
						><Table.Cell colspan={8} class="py-6 text-center text-ink-muted"
							>No shifts yet.</Table.Cell
						></Table.Row
					>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
