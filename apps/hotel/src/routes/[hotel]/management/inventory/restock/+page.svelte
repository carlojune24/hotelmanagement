<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ReceiptIcon from '@lucide/svelte/icons/receipt';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/${page.params.hotel}/management/inventory/restock`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const dateFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
	const fmtDate = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));
	const EXPENSE: Record<string, string> = { draft: 'Expense awaiting approval', approved: 'Expense to pay', paid: 'Paid', void: 'Voided' };
</script>

<svelte:head><title>Restock · Inventory</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="max-w-4xl">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<h2 class="text-base font-semibold text-ink">Restock</h2>
				<p class="mt-1 text-sm text-ink-muted">
					Encode each supplier receipt once: its items go into stock and its total becomes an expense in Finance, for Finance to pay.
				</p>
			</div>
			{#if data.inventory.canWrite}
				<Button class="h-11" href="{base}/new"><PlusIcon class="size-4" />New restock</Button>
			{/if}
		</div>

		{#if data.restocks.length}
			<ul class="mt-6 divide-y divide-border border-t border-border">
				{#each data.restocks as r (r.id)}
					<li>
						<a href="{base}/{r.id}" class="flex items-center gap-3 py-2.5 hover:bg-surface-2">
							<div class="min-w-0 flex-1">
								<p class="truncate text-base {r.voidedAt ? 'text-ink-muted line-through decoration-1' : 'text-ink'}">
									{r.supplier ?? 'No supplier named'}{r.receiptNo ? ` · ${r.receiptNo}` : ''}
								</p>
								<p class="text-xs text-ink-muted">
									{fmtDate(r.receiptDate)} · {r.lines} item{r.lines === 1 ? '' : 's'}{r.createdByName ? ` · ${r.createdByName}` : ''}
									{#if r.voidedAt}· Voided{:else if r.expenseStatus}· {EXPENSE[r.expenseStatus] ?? r.expenseStatus}{/if}
								</p>
							</div>
							<span class="text-base font-medium tabular-nums text-ink">{peso(r.totalCentavos)}</span>
							<ChevronRightIcon class="size-4 text-ink-muted" aria-hidden="true" />
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<div class="mt-8 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
				<ReceiptIcon class="mx-auto mb-2 size-6" aria-hidden="true" />
				<p class="font-medium text-ink">No receipts encoded yet.</p>
				<p class="mt-1">When a delivery arrives, press New restock and copy the receipt in.</p>
			</div>
		{/if}
	</div>
</div>
