<script lang="ts">
	import type { BillLine } from '$lib/dining-bill';
	import { thermalPadding } from '$lib/print-batch';

	let {
		hotelName,
		where,
		guestName = null,
		printedAtIso,
		timezone,
		lines,
		totalCentavos,
		widthMm = 80,
		autoPrint = false
	}: {
		hotelName: string;
		/** `Table 4`, `Takeaway`… */
		where: string;
		/** Who ordered, when we know: the name on the order. */
		guestName?: string | null;
		printedAtIso: string;
		timezone: string;
		lines: BillLine[];
		totalCentavos: number;
		widthMm?: 58 | 80;
		/** Opens the browser's print dialog as soon as the page size is measured. */
		autoPrint?: boolean;
	} = $props();

	// Same money and date style as the official receipt and invoice (`thermal-receipt.svelte`).
	const peso = (c: number) => `P ${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	// The bill carries the hotel's own clock, not the printing computer's.
	const stamp = $derived(
		new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(printedAtIso))
	);

	// Same technique as thermal-receipt.svelte: measure the content and declare an exact page length so a
	// short bill doesn't print with a long blank tail.
	let pageEl = $state<HTMLDivElement>();
	let pageHeightMm = $state(120);
	const PX_TO_MM = 25.4 / 96;
	function measure() {
		if (!pageEl) return;
		const px = pageEl.getBoundingClientRect().height;
		if (px > 0) pageHeightMm = Math.ceil(px * PX_TO_MM) + 2;
	}
	let hasAutoPrinted = false;
	$effect(() => {
		if (!pageEl) return;
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(pageEl);
		window.addEventListener('beforeprint', measure);
		if (autoPrint && !hasAutoPrinted) {
			hasAutoPrinted = true;
			requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
		}
		return () => {
			ro.disconnect();
			window.removeEventListener('beforeprint', measure);
		};
	});
</script>

<svelte:head>
	<style>{`@page { size: ${widthMm}mm ${pageHeightMm}mm; margin: 0; }`}</style>
</svelte:head>

<div class="tr-page" style="--tr-width: {widthMm}mm; --tr-pad: {thermalPadding(widthMm)}" bind:this={pageEl}>
	<div class="tr-hotel-name">{hotelName}</div>

	<div class="tr-rule"></div>

	<div class="tr-doctype-block">
		<div class="tr-doctype">Bill</div>
	</div>

	<div class="tr-row"><span>For</span><span>{where}</span></div>
	{#if guestName}<div class="tr-row"><span>Guest</span><span>{guestName}</span></div>{/if}
	<div class="tr-row"><span>Date</span><span>{stamp}</span></div>

	<div class="tr-rule tr-dashed"></div>

	{#if lines.length === 0}
		<div class="tr-center tr-muted">Nothing has been ordered yet.</div>
	{/if}
	{#each lines as l, n (n)}
		<div class="tr-item-desc">{l.description}</div>
		<div class="tr-row tr-item-amount">
			<span>{l.quantity} x {peso(l.unitPriceCentavos)}</span>
			<span>{peso(l.lineTotalCentavos)}</span>
		</div>
	{/each}

	<div class="tr-rule tr-dashed"></div>

	<div class="tr-row tr-total-row"><span>TOTAL</span><span>{peso(totalCentavos)}</span></div>
</div>

<style>
	/* The look is the official receipt's, rule for rule (`thermal-receipt.svelte`), so a bill and an OR
	   from the same printer match. Only the content is smaller. */
	.tr-page {
		--tr-ink: #000;
		--tr-muted: #000;
		box-sizing: border-box;
		width: var(--tr-width);
		margin: 0 auto;
		padding: var(--tr-pad);
		background: #fff;
		color: var(--tr-ink);
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 700;
		font-size: 9pt;
		line-height: 1.35;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.tr-page :global(*) {
		box-sizing: border-box;
	}
	.tr-center {
		text-align: center;
	}
	.tr-muted {
		color: var(--tr-muted);
	}
	.tr-hotel-name {
		text-align: center;
		font-size: 12.5pt;
		font-weight: 800;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}
	.tr-rule {
		border-top: 1px solid var(--tr-ink);
		margin: 1.8mm 0;
	}
	.tr-dashed {
		border-top-style: dashed;
	}
	.tr-doctype-block {
		border: 2px solid #000;
		border-top-width: 3px;
		border-bottom-width: 3px;
		text-align: center;
		padding: 1.6mm 1mm;
		margin: 1.5mm 0;
	}
	.tr-doctype {
		font-size: 12pt;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.tr-row {
		display: flex;
		justify-content: space-between;
		gap: 2mm;
		padding: 0.3mm 0;
	}
	.tr-row span:first-child {
		color: var(--tr-muted);
		flex-shrink: 0;
	}
	.tr-row span:last-child {
		text-align: right;
		font-weight: 800;
		min-width: 0;
		overflow-wrap: break-word;
	}
	.tr-item-desc {
		margin-top: 1.2mm;
	}
	.tr-item-amount span:first-child {
		color: var(--tr-ink);
	}
	.tr-total-row {
		border-top: 1px solid var(--tr-ink);
		margin-top: 0.6mm;
		padding-top: 0.8mm;
		font-weight: 800;
		font-size: 10.5pt;
	}

	@media screen {
		.tr-page {
			margin: 24px auto;
			border: 1px solid #ccc;
		}
	}
	@media print {
		.tr-page {
			margin: 0;
		}
	}
</style>
