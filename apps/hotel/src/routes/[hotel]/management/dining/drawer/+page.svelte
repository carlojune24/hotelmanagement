<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import OpenShiftCard from '$lib/components/staff/open-shift-card.svelte';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const slug = $derived(page.params.hotel!);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">
		{data.drawer?.name ?? 'Dining drawer'}
	</h1>
	<p class="mb-4 text-sm text-ink-muted">
		Dining's own till. Only this drawer's shifts are shown — the front desk counts its own.
	</p>

	{#if !data.drawer}
		<div class="rounded-xl border border-border p-5 text-sm text-ink-muted">
			No dining drawer is set up yet, so dining cash goes into the front desk drawer. An admin
			picks one in
			<a href="/{slug}/management/finance/settings" class="underline underline-offset-2">
				Finance → Settings
			</a>.
		</div>
	{:else if data.recon}
		<OpenShiftCard recon={data.recon} expenseCategories={data.expenseCategories} />
	{:else}
		<form
			method="POST"
			action="?/openShift"
			use:enhance
			class="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-border p-4"
		>
			<div>
				<Label class="text-xs" for="openingFloat">Opening float (₱)</Label>
				<input
					id="openingFloat"
					name="openingFloat"
					type="number"
					min="0"
					step="0.01"
					placeholder="0.00"
					class="mt-1 h-9 w-32 rounded-md border border-input bg-transparent px-2 text-sm"
					required
				/>
			</div>
			<Button type="submit" class="h-9"><ClockIcon class="size-4" /> Open shift</Button>
			<p class="w-full text-xs text-ink-muted">
				The drawer is closed, so cash can't be taken in Dining yet.
			</p>
		</form>
	{/if}

	{#if data.drawer}
		<h2 class="mt-6 mb-2 text-sm font-semibold text-ink">Shift history</h2>
		<div class="overflow-x-auto rounded-xl border border-border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Date</Table.Head>
						<Table.Head>Cashier</Table.Head>
						<Table.Head class="text-right">Opening</Table.Head>
						<Table.Head class="text-right">Expected</Table.Head>
						<Table.Head class="text-right">Counted</Table.Head>
						<Table.Head class="text-right">Variance</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.shifts as s (s.id)}
						<Table.Row>
							<Table.Cell class="whitespace-nowrap text-ink-muted">
								{s.businessDate}
								{#if s.status === 'open'}
									<Badge variant="outline" class="ml-1.5 border-transparent bg-ok/15 text-ok">Open</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-ink-muted">{s.openedByName ?? '—'}</Table.Cell>
							<Table.Cell class="text-right tabular-nums text-ink-muted">
								{peso(s.openingFloatCentavos)}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums text-ink-muted">
								{s.expectedCashCentavos != null ? peso(s.expectedCashCentavos) : '—'}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums text-ink">
								{s.countedCashCentavos != null ? peso(s.countedCashCentavos) : '—'}
							</Table.Cell>
							<Table.Cell
								class="text-right tabular-nums {s.varianceCentavos
									? s.varianceCentavos < 0
										? 'text-danger'
										: 'text-brand'
									: 'text-ink-muted'}"
							>
								{s.varianceCentavos != null ? peso(s.varianceCentavos) : '—'}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={6} class="py-8 text-center text-sm text-ink-muted">
								No shifts on this drawer yet.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>
