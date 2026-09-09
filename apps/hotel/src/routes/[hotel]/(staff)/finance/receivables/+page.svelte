<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			settlingId = null;
		}
		if (form && 'error' in form && form.error) toast.error(form.error);
	});
	let settlingId = $state<string | null>(null);

	const statusClass: Record<string, string> = {
		open: 'border-transparent bg-danger/15 text-danger',
		partial: 'border-transparent bg-brand/15 text-brand',
		settled: 'border-transparent bg-ok/15 text-ok',
		written_off: 'border-border bg-surface-2 text-ink-muted'
	};
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">City ledger</h1>
			<p class="text-sm text-ink-muted">Balances guests or companies still owe after checkout.</p>
		</div>
		<div class="flex gap-1 text-sm">
			<a href="?show=active" class="rounded-md px-3 py-1.5 {data.show === 'active' ? 'bg-surface-2 text-ink' : 'text-ink-muted'}">Outstanding</a>
			<a href="?show=all" class="rounded-md px-3 py-1.5 {data.show === 'all' ? 'bg-surface-2 text-ink' : 'text-ink-muted'}">All</a>
		</div>
	</div>

	<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
		{#each data.aging.buckets as b (b.label)}
			<div class="rounded-xl border border-border p-4">
				<div class="text-xs text-ink-muted">{b.label}</div>
				<div class="mt-1 text-lg font-semibold text-ink tabular-nums">{peso(b.amountCentavos)}</div>
				<div class="text-xs text-ink-muted">{b.count} account(s)</div>
			</div>
		{/each}
	</div>

	<div class="overflow-x-auto rounded-xl border border-border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Opened</Table.Head>
					<Table.Head>Bill to</Table.Head>
					<Table.Head class="text-right">Original</Table.Head>
					<Table.Head class="text-right">Outstanding</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.rows as r (r.id)}
					<Table.Row>
						<Table.Cell class="whitespace-nowrap text-ink-muted">{new Date(r.openedAt).toISOString().slice(0, 10)}</Table.Cell>
						<Table.Cell class="text-ink">
							{r.billToName}
							{#if r.billToCompany}<span class="block text-xs text-ink-muted">{r.billToCompany}</span>{/if}
							{#if r.referenceNo}<span class="block text-xs text-ink-muted">Ref {r.referenceNo}</span>{/if}
						</Table.Cell>
						<Table.Cell class="text-right tabular-nums text-ink-muted">{peso(r.originalAmountCentavos)}</Table.Cell>
						<Table.Cell class="text-right tabular-nums font-medium text-ink">{peso(r.outstandingCentavos)}</Table.Cell>
						<Table.Cell><Badge variant="outline" class={statusClass[r.status]}>{r.status.replace('_', ' ')}</Badge></Table.Cell>
						<Table.Cell class="text-right whitespace-nowrap">
							{#if (r.status === 'open' || r.status === 'partial') && data.finance.canReceivable}
								<button type="button" onclick={() => (settlingId = settlingId === r.id ? null : r.id)} class="text-xs text-ok underline underline-offset-2">Collect</button>
								{#if data.finance.canAdmin}
									<form method="POST" action="?/writeOff" use:enhance class="inline">
										<input type="hidden" name="id" value={r.id} />
										<input type="hidden" name="reason" value="Written off from city ledger" />
										<button class="ml-2 text-xs text-ink-muted underline underline-offset-2 hover:text-danger">Write off</button>
									</form>
								{/if}
							{/if}
						</Table.Cell>
					</Table.Row>
					{#if settlingId === r.id}
						<Table.Row>
							<Table.Cell colspan={6} class="bg-surface-2">
								<form method="POST" action="?/settle" use:enhance class="flex flex-wrap items-end gap-2">
									<input type="hidden" name="id" value={r.id} />
									<div>
										<Label class="text-xs">Amount (₱)</Label>
										<Input name="amount" type="number" min="0.01" step="0.01" value={(r.outstandingCentavos / 100).toFixed(2)} class="mt-1 h-8 w-32" />
									</div>
									<div>
										<Label class="text-xs">Method</Label>
										<select name="method" class="mt-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm">
											{#each data.methods as m (m)}<option value={m}>{m.replace('_', ' ')}</option>{/each}
										</select>
									</div>
									<div><Label class="text-xs">Reference</Label><Input name="referenceNo" class="mt-1 h-8" /></div>
									<Button type="submit" size="sm">Record collection</Button>
								</form>
							</Table.Cell>
						</Table.Row>
					{/if}
				{:else}
					<Table.Row><Table.Cell colspan={6} class="py-6 text-center text-ink-muted">Nothing outstanding.</Table.Cell></Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
