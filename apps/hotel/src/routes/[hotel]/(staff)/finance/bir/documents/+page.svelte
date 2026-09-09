<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const printHref = (d: { id: string; type: string }) =>
		`${base}/print/${d.type === 'invoice' ? 'invoice' : 'receipt'}/${d.id}`;

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	let cancelId = $state<string | null>(null);

	const filters = [
		{ v: 'all', label: 'All' },
		{ v: 'invoice', label: 'Invoices' },
		{ v: 'official_receipt', label: 'Official Receipts' }
	];
	const statusVariant = (s: string) =>
		s === 'issued' ? 'secondary' : s === 'cancelled' ? 'destructive' : 'outline';
</script>

<div class="mb-3 flex gap-1">
	{#each filters as f (f.v)}
		<a
			href={f.v === 'all' ? '?' : `?type=${f.v}`}
			class="rounded-md px-2.5 py-1 text-xs font-medium {data.type === f.v
				? 'bg-surface-2 text-ink'
				: 'text-ink-muted hover:text-ink'}"
		>
			{f.label}
		</a>
	{/each}
</div>

{#if data.documents.length === 0}
	<p class="rounded-xl border border-dashed border-border p-6 text-center text-sm text-ink-muted">
		No documents issued yet. Invoices issue at check-out and Official Receipts when a payment is
		recorded (see BIR → Setup toggles), or on first print.
	</p>
{:else}
	<div class="overflow-x-auto rounded-xl border border-border">
		<table class="w-full text-sm">
			<thead class="border-b border-border bg-surface-2 text-left text-xs text-ink-muted">
				<tr>
					<th class="px-3 py-2">No.</th>
					<th class="px-3 py-2">Type</th>
					<th class="px-3 py-2">Bill to</th>
					<th class="px-3 py-2 text-right">Amount</th>
					<th class="px-3 py-2">Issued</th>
					<th class="px-3 py-2">Status</th>
					<th class="px-3 py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.documents as d (d.id)}
					<tr class="border-b border-border/60 last:border-0">
						<td class="px-3 py-2 font-mono">{d.formattedNo}</td>
						<td class="px-3 py-2">{d.type === 'invoice' ? 'Invoice' : 'Official Receipt'}</td>
						<td class="px-3 py-2">{d.billToName ?? '—'}</td>
						<td class="px-3 py-2 text-right font-mono">
							{d.status === 'spoiled' ? '—' : peso(d.grossCentavos)}
						</td>
						<td class="px-3 py-2 text-ink-muted">
							{new Date(d.issuedAt).toLocaleDateString('en-PH')}
						</td>
						<td class="px-3 py-2"><Badge variant={statusVariant(d.status)}>{d.status}</Badge></td>
						<td class="px-3 py-2 text-right whitespace-nowrap">
							{#if d.status !== 'spoiled'}
								<a class="text-xs font-medium underline" href={printHref(d)} target="_blank">Print</a>
							{/if}
							{#if data.canWrite && d.status === 'issued'}
								<button
									type="button"
									class="ml-3 text-xs font-medium text-danger underline"
									onclick={() => (cancelId = cancelId === d.id ? null : d.id)}
								>
									Cancel
								</button>
							{/if}
						</td>
					</tr>
					{#if cancelId === d.id}
						<tr class="border-b border-border/60 bg-surface-2/50">
							<td colspan="7" class="px-3 py-3">
								<form
									method="POST"
									action="?/cancel"
									use:enhance={() => async ({ update }) => {
										await update();
										cancelId = null;
									}}
									class="flex flex-wrap items-end gap-3"
								>
									<input type="hidden" name="documentId" value={d.id} />
									<div class="min-w-64 flex-1">
										<Label class="text-xs" for="reason-{d.id}">
											Reason for cancelling {d.formattedNo}
										</Label>
										<Input id="reason-{d.id}" name="reason" placeholder="e.g. wrong guest name" />
									</div>
									<label class="flex items-center gap-2 pb-2 text-xs">
										<input type="checkbox" name="issueReplacement" class="size-4" />
										Issue a replacement {d.type === 'invoice' ? 'Invoice' : 'Official Receipt'}
									</label>
									<Button type="submit" size="sm" variant="destructive">Cancel document</Button>
								</form>
								<p class="mt-2 text-xs text-ink-muted">
									The serial number stays permanently used. This does not void the payment or folio —
									handle the money separately at the front desk if it's being reversed.
								</p>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
{/if}
