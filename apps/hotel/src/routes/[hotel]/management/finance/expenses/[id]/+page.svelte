<script lang="ts">
	import { page } from '$app/state';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const e = $derived(data.expense);
	const listHref = $derived(`/${page.params.hotel}/management/finance/expenses`);
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
	const when = (d: string | Date | null) => (d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
	// paidAt is midnight of the picked "Paid on" day, so a time of day would be invented.
	const day = (d: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '—');

	const statusClass: Record<string, string> = {
		draft: 'border-border bg-surface-2 text-ink-muted',
		approved: 'border-transparent bg-brand/15 text-brand',
		paid: 'border-transparent bg-ok/15 text-ok',
		void: 'border-transparent bg-danger/15 text-danger'
	};
</script>

<svelte:head><title>{e.description} · Expenses</title></svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<div class="mb-4 flex items-center justify-between print:hidden">
		<a href={listHref} class="text-sm text-ink-muted underline underline-offset-2 hover:text-ink">← Expenses</a>
		<Button size="sm" variant="outline" onclick={() => window.print()}>
			<PrinterIcon class="size-4" aria-hidden="true" /> Print
		</Button>
	</div>

	<h1 class="text-xl font-semibold tracking-tight text-balance text-ink">{e.description}</h1>
	<p class="mt-1 mb-6 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
		<span class="tabular-nums">{e.expenseDate}</span>
		<span class="rounded px-1.5 py-0.5 text-[11px] font-medium {e.source === 'dining' ? 'bg-warning/20 text-ink' : 'bg-brand/10 text-brand'}">{e.source === 'dining' ? 'Dining' : 'Hotel'}</span>
		<Badge variant="outline" class={statusClass[e.status]}>{e.status}</Badge>
	</p>

	<dl class="mb-6 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
		<div><dt class="text-xs text-ink-muted">Category</dt><dd class="text-ink">{e.categoryName}</dd></div>
		<div><dt class="text-xs text-ink-muted">Vendor</dt><dd class="text-ink">{e.vendorName ?? '—'}</dd></div>
		<div><dt class="text-xs text-ink-muted">Invoice / OR no.</dt><dd class="text-ink">{e.vendorInvoiceNo ?? '—'}</dd></div>
	</dl>

	<section aria-labelledby="amounts" class="mb-6">
		<h2 id="amounts" class="mb-2 text-sm font-semibold text-ink">Amounts</h2>
		<div class="overflow-hidden rounded-xl border border-border">
			<dl class="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
				<div class="bg-background p-3"><dt class="text-xs text-ink-muted">Amount on receipt</dt><dd class="mt-0.5 tabular-nums text-ink">{peso(e.grossCentavos)}</dd></div>
				<div class="bg-background p-3">
					<dt class="text-xs text-ink-muted">Input VAT</dt>
					<dd class="mt-0.5 tabular-nums text-ink">{e.isVatable ? peso(e.inputVatCentavos) : '—'}</dd>
					{#if !e.isVatable}<dd class="text-xs text-ink-muted">No VAT on receipt</dd>{/if}
				</div>
				<div class="bg-background p-3"><dt class="text-xs text-ink-muted">Net of VAT</dt><dd class="mt-0.5 tabular-nums text-ink">{peso(e.netOfVatCentavos)}</dd></div>
				<div class="bg-background p-3"><dt class="text-xs text-ink-muted">Withholding tax</dt><dd class="mt-0.5 tabular-nums text-ink">{peso(e.withholdingTaxCentavos)}</dd></div>
			</dl>
			<div class="flex items-baseline justify-between border-t border-border px-3 py-2.5">
				<span class="text-sm text-ink">Pay vendor</span>
				<span class="text-base font-semibold tabular-nums text-ink">{peso(e.grossCentavos - e.withholdingTaxCentavos)}</span>
			</div>
		</div>
		{#if e.withholdingTaxCentavos > 0}
			<p class="mt-1.5 text-xs text-ink-muted">{peso(e.withholdingTaxCentavos)} withheld — remit to BIR.</p>
		{/if}
	</section>

	<section aria-labelledby="payment" class="mb-6">
		<h2 id="payment" class="mb-2 text-sm font-semibold text-ink">Payment</h2>
		<dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
			<div><dt class="text-xs text-ink-muted">Paid on</dt><dd class="text-ink">{day(e.paidAt)}</dd></div>
			<div><dt class="text-xs text-ink-muted">Paid from</dt><dd class="text-ink">{e.paidFromName ?? '—'}</dd></div>
			<div><dt class="text-xs text-ink-muted">Method</dt><dd class="text-ink capitalize">{e.paymentMethod?.replace('_', ' ') ?? '—'}</dd></div>
			<div><dt class="text-xs text-ink-muted">Reference</dt><dd class="break-all text-ink">{e.paymentReferenceNo ?? '—'}</dd></div>
		</dl>
	</section>

	<section aria-labelledby="history" class="mb-6">
		<h2 id="history" class="mb-2 text-sm font-semibold text-ink">History</h2>
		<dl class="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
			<div><dt class="text-xs text-ink-muted">Recorded</dt><dd class="text-ink">{when(e.createdAt)}{e.createdByName ? ` by ${e.createdByName}` : ''}</dd></div>
			<div><dt class="text-xs text-ink-muted">Approved</dt><dd class="text-ink">{e.approvedAt ? `${when(e.approvedAt)}${e.approvedByName ? ` by ${e.approvedByName}` : ''}` : '—'}</dd></div>
		</dl>
		{#if e.recurringExpenseId}
			<p class="mt-2 text-sm text-ink-muted">Created from a <a href="{listHref}/recurring" class="underline underline-offset-2 hover:text-ink">recurring template</a>.</p>
		{/if}
	</section>

	{#if e.notes}
		<section aria-labelledby="notes" class="mb-6">
			<h2 id="notes" class="mb-2 text-sm font-semibold text-ink">Notes</h2>
			<p class="max-w-prose text-sm whitespace-pre-line text-ink">{e.notes}</p>
		</section>
	{/if}

	<section aria-labelledby="receipt">
		<h2 id="receipt" class="mb-2 text-sm font-semibold text-ink">Receipt photo</h2>
		{#if e.attachmentUrl}
			<a href={e.attachmentUrl} target="_blank" rel="noopener" class="inline-block">
				<img src={e.attachmentUrl} alt="Receipt for {e.description}" class="max-h-96 rounded-lg border border-border" />
			</a>
			<p class="mt-1 text-xs text-ink-muted print:hidden">Click the photo to open it full size.</p>
		{:else}
			<p class="text-sm text-ink-muted">No receipt photo attached.</p>
		{/if}
	</section>
</div>
