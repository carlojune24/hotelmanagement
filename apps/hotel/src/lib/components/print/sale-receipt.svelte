<script lang="ts">
	interface SaleReceiptLine {
		description: string;
		quantity: number;
		unitPriceCentavos: number;
		lineTotalCentavos: number;
	}

	let {
		hotel,
		saleRef,
		issuedAtIso,
		method,
		lines,
		totalCentavos,
		tenderedCentavos = null,
		changeCentavos = 0,
		widthMm = 80,
		autoPrint = false
	}: {
		hotel: { name: string; legalName: string | null; address: string | null; tin: string | null; isVatRegistered: boolean };
		saleRef: string;
		issuedAtIso: string;
		method: string;
		lines: SaleReceiptLine[];
		totalCentavos: number;
		tenderedCentavos?: number | null;
		changeCentavos?: number;
		widthMm?: 58 | 80;
		/** Opens the browser's print dialog itself the moment the page has its real
		 *  `@page` size measured — still a real dialog (the web platform has no
		 *  fully silent print API), but skips the manual "Print / Save as PDF"
		 *  toolbar click. */
		autoPrint?: boolean;
	} = $props();

	const peso = (c: number) =>
		`P ${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const fmtDateTime = (iso: string) => {
		const d = new Date(iso);
		return d.toLocaleString('en-PH', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
	};

	// Same technique as thermal-receipt.svelte: `size: <len> auto` is invalid CSS
	// and gets silently dropped, so the printer driver's own fixed paper preset
	// wins instead — measure the rendered content and declare an exact page
	// length so a short receipt doesn't print with a long blank tail.
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
			// Double rAF: let the @page size (svelte:head style) and layout actually
			// flush before invoking print, or the dialog can grab a stale/measured-
			// before-content-settled page size.
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

<div class="tr-page" style="--tr-width: {widthMm}mm" bind:this={pageEl}>
	<div class="tr-hotel-name">{hotel.legalName || hotel.name}</div>
	{#if hotel.legalName && hotel.legalName !== hotel.name}
		<div class="tr-center tr-muted">operating as {hotel.name}</div>
	{/if}
	{#if hotel.address}<div class="tr-center tr-muted">{hotel.address}</div>{/if}
	{#if hotel.tin}
		<div class="tr-center tr-muted">TIN {hotel.tin} &middot; {hotel.isVatRegistered ? 'VAT REG' : 'NON-VAT REG'}</div>
	{/if}

	<div class="tr-rule"></div>

	<div class="tr-doctype-block">
		<div class="tr-doctype">Sales Receipt</div>
		<div class="tr-serial-no">{saleRef}</div>
	</div>

	<div class="tr-row"><span>Date</span><span>{fmtDateTime(issuedAtIso)}</span></div>

	<div class="tr-rule tr-dashed"></div>

	{#each lines as l, i (i)}
		<div class="tr-item-desc">{l.description}</div>
		<div class="tr-row tr-item-amount">
			<span>{l.quantity} x {peso(l.unitPriceCentavos)}</span>
			<span>{peso(l.lineTotalCentavos)}</span>
		</div>
	{/each}

	<div class="tr-rule tr-dashed"></div>

	<div class="tr-row tr-total-row"><span>TOTAL</span><span>{peso(totalCentavos)}</span></div>
	<div class="tr-row"><span>Payment method</span><span>{method.replace(/_/g, ' ')}</span></div>
	{#if tenderedCentavos != null}
		<div class="tr-row"><span>Cash tendered</span><span>{peso(tenderedCentavos)}</span></div>
		<div class="tr-row"><span>Change</span><span>{peso(changeCentavos)}</span></div>
	{/if}

	<div class="tr-rule tr-dashed"></div>

	<div class="tr-legal">
		<p class="tr-legal-strong">Computer-generated receipt — not an official/BIR-registered document.</p>
	</div>

	<div class="tr-close">Thank you for your purchase.</div>
</div>

<style>
	/* Same tokens/family as thermal-receipt.svelte (Accountable Forms world,
	   monochrome continuous-roll variant) — deliberately not the same component,
	   since a walk-up sale never claims BIR document status (no permit/serial/
	   signature block), but it reads as the same receipt genre at the counter. */
	.tr-page {
		--tr-ink: #000;
		--tr-muted: #000;
		box-sizing: border-box;
		width: var(--tr-width);
		margin: 0 auto;
		padding: 3mm 2.5mm;
		background: #fff;
		color: var(--tr-ink);
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 500;
		font-size: 8pt;
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
		font-size: 11pt;
		font-weight: 700;
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
		font-size: 11pt;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.tr-serial-no {
		font-size: 11pt;
		font-weight: 700;
		margin-top: 0.5mm;
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
		font-weight: 600;
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
		font-weight: 700;
		font-size: 9pt;
	}
	.tr-legal {
		font-size: 6.5pt;
		line-height: 1.5;
		color: var(--tr-muted);
	}
	.tr-legal p {
		margin: 0 0 0.6mm;
	}
	.tr-legal-strong {
		font-weight: 700;
		color: var(--tr-ink);
	}
	.tr-close {
		text-align: center;
		margin-top: 2mm;
		font-weight: 600;
		font-size: 8pt;
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
