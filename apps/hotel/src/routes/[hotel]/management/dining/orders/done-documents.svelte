<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { DOCUMENT_TYPE_LABEL, batchPrintHref, type IssuedDocument } from '$lib/print-batch';

	let {
		documents,
		documentError = null,
		slug,
		billHref = null,
		auto = false
	}: {
		documents: IssuedDocument[];
		documentError?: string | null;
		slug: string;
		/** The plain bill to print when no document was issued (a "Normal Bill" payment). */
		billHref?: string | null;
		/** Open the print window now. Runs once, when this appears (the payment has just gone through). */
		auto?: boolean;
	} = $props();

	const ids = $derived(documents.map((d) => d.id));
	const allHref = $derived(documents.length > 0 ? batchPrintHref(slug, ids, { auto: true }) : billHref);
	const noun = $derived(documents.length > 1 ? 'documents' : documents[0] ? DOCUMENT_TYPE_LABEL[documents[0].type].toLowerCase() : 'bill');

	let tried = false;
	$effect(() => {
		if (!auto || tried || !allHref) return;
		tried = true;
		// Opened after the payment's round trip, so a strict browser may refuse it. The button below always works.
		const win = window.open(allHref, '_blank');
		if (!win) toast.info(`Your browser blocked the print window. Tap "Print ${noun}" below.`);
	});
</script>

{#if documentError}
	<div class="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-left text-sm text-ink" role="alert">
		<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
		<p>
			Paid, but the document could not be issued: {documentError}
			Fix it in Finance → BIR, then issue it from the order.
		</p>
	</div>
{/if}

{#if documents.length > 0}
	<ul class="divide-y divide-border rounded-lg border border-border text-left text-sm" aria-label="Issued documents">
		{#each documents as d (d.id)}
			<li class="flex items-center justify-between gap-3 px-3 py-2">
				<span class="min-w-0">
					<span class="font-mono font-semibold text-ink">{d.formattedNo}</span>
					{#if d.orderCode}<span class="ml-2 font-mono text-xs text-ink-muted">{d.orderCode}</span>{/if}
				</span>
				{#if documents.length > 1}
					<Button href={batchPrintHref(slug, [d.id], { auto: true })} target="_blank" rel="noopener" variant="ghost" size="sm" class="h-8">
						<PrinterIcon class="size-3.5" aria-hidden="true" /> Print
					</Button>
				{/if}
			</li>
		{/each}
	</ul>
	<Button href={allHref} target="_blank" rel="noopener" class="h-11 w-full">
		<PrinterIcon class="size-4" aria-hidden="true" />
		{documents.length > 1 ? `Print all ${documents.length}` : `Print ${noun}`}
	</Button>
{:else if billHref}
	<p class="text-xs text-ink-muted">No receipt or invoice was issued. You can issue either later from the order.</p>
	<Button href={billHref} target="_blank" rel="noopener" class="h-11 w-full">
		<PrinterIcon class="size-4" aria-hidden="true" /> Print bill
	</Button>
{/if}
