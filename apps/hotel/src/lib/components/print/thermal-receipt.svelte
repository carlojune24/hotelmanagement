<script lang="ts">
	import type { DocumentSnapshot } from '$lib/server/finance/documents';

	let {
		snapshot,
		logoUrl = null,
		cancelled = false,
		widthMm = 80
	}: {
		snapshot: DocumentSnapshot;
		logoUrl?: string | null;
		cancelled?: boolean;
		widthMm?: 58 | 80;
	} = $props();

	const peso = (c: number) =>
		`P ${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const fmtDateTime = (iso: string) => {
		if (!iso) return '—';
		const d = new Date(iso);
		return d.toLocaleString('en-PH', {
			year: 'numeric',
			month: 'short',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	};

	const doc = $derived(snapshot.document);
	const isInvoice = $derived(doc.type === 'invoice');
	const isReceipt = $derived(doc.type === 'official_receipt');
	const t = $derived(snapshot.totals);
	const vat = $derived(snapshot.hotel.isVatRegistered);

	const permitLine = $derived(
		[
			`Permit/ATP No. ${snapshot.bir.permitNo ?? '—'}`,
			snapshot.bir.permitDateIssued ? `issued ${snapshot.bir.permitDateIssued}` : null
		]
			.filter(Boolean)
			.join(', ') + '.'
	);
	const printerLine = $derived(
		snapshot.bir.accreditedPrinter
			? `Printed by ${snapshot.bir.accreditedPrinter}` +
					(snapshot.bir.accreditationNo ? ` (Accred. No. ${snapshot.bir.accreditationNo}).` : '.')
			: null
	);
	const serialRangeLine = $derived(
		snapshot.bir.serialRange
			? `Authorized range ${snapshot.bir.serialRange.prefix} ${snapshot.bir.serialRange.from}–${snapshot.bir.serialRange.to}.`
			: null
	);

	// `@page { size: <length> auto }` isn't valid CSS (`size` takes one or two
	// lengths, or the bare keyword `auto` — never a length *and* `auto` together),
	// so Chrome silently drops the whole declaration and falls back to whatever
	// fixed paper size the printer driver advertises (e.g. a POS-80 driver's own
	// "80 x 210mm" preset) — which is why a short receipt used to print with a
	// long blank tail. Measuring the rendered content and declaring an exact
	// page length instead makes the page height actually match the receipt.
	let pageEl = $state<HTMLDivElement>();
	let pageHeightMm = $state(200);
	const PX_TO_MM = 25.4 / 96;

	function measure() {
		if (!pageEl) return;
		const px = pageEl.getBoundingClientRect().height;
		if (px > 0) pageHeightMm = Math.ceil(px * PX_TO_MM) + 2;
	}

	$effect(() => {
		if (!pageEl) return;
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(pageEl);
		window.addEventListener('beforeprint', measure);
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
	<!-- Skipped on 80mm paper only — a logo image costs real time/ink on a thermal
	     head (per a real print test) and 80mm is this hotel's actual roll width;
	     a 58mm hotel still gets it. -->
	{#if logoUrl && widthMm !== 80}
		<img class="tr-logo" src={logoUrl} alt="" />
	{/if}
	<div class="tr-hotel-name">{snapshot.hotel.legalName || snapshot.hotel.name}</div>
	{#if snapshot.hotel.legalName && snapshot.hotel.legalName !== snapshot.hotel.name}
		<div class="tr-center tr-muted">operating as {snapshot.hotel.name}</div>
	{/if}
	{#if snapshot.hotel.address}
		<div class="tr-center tr-muted">{snapshot.hotel.address}</div>
	{/if}
	<div class="tr-center tr-muted">
		{#if snapshot.hotel.tin}TIN {snapshot.hotel.tin} &middot; {/if}
		{vat ? 'VAT REG' : 'NON-VAT REG'}
	</div>

	<div class="tr-rule"></div>

	<div class="tr-doctype-block">
		<div class="tr-doctype">{doc.typeLabel}</div>
		<div class="tr-serial-no">No. {doc.formattedNo || '—'}</div>
		<div class="tr-copy-tag" class:is-cancelled={cancelled}>
			{cancelled ? '✖ CANCELLED ✖' : doc.isReprint ? 'REPRINT' : 'ORIGINAL'}
		</div>
	</div>

	<div class="tr-row"><span>Date issued</span><span>{fmtDateTime(doc.issuedAtIso)}</span></div>
	<div class="tr-row"><span>Business date</span><span>{doc.businessDate}</span></div>
	{#if doc.preparedBy}
		<div class="tr-row"><span>Prepared by</span><span>{doc.preparedBy}</span></div>
	{/if}

	<div class="tr-rule tr-dashed"></div>

	<div class="tr-label">{isReceipt ? 'Received from' : 'Bill to'}</div>
	<div class="tr-value">{snapshot.billTo.name ?? '—'}</div>
	{#if snapshot.billTo.address}<div class="tr-muted">{snapshot.billTo.address}</div>{/if}
	{#if snapshot.billTo.tin}<div class="tr-muted">TIN {snapshot.billTo.tin}</div>{/if}

	{#if snapshot.reference.appliedToInvoiceNo}
		<div class="tr-row"><span>Applied to inv.</span><span>{snapshot.reference.appliedToInvoiceNo}</span></div>
	{/if}
	{#if snapshot.reference.bookingRef}
		<div class="tr-row"><span>Booking</span><span>{snapshot.reference.bookingRef}</span></div>
	{/if}
	{#if snapshot.reference.stayDates}
		<div class="tr-row"><span>Dates</span><span>{snapshot.reference.stayDates}</span></div>
	{/if}
	{#if snapshot.reference.folioRef}
		<div class="tr-row"><span>Folio</span><span>{snapshot.reference.folioRef}</span></div>
	{/if}
	{#if snapshot.reference.orderRef}
		<div class="tr-row"><span>Order</span><span>{snapshot.reference.orderRef}</span></div>
	{/if}

	<div class="tr-rule tr-dashed"></div>

	{#each snapshot.lines as l, i (i)}
		<div class="tr-item-desc">
			{l.description}{#if isInvoice && vat && !l.vatable}<span class="tr-muted"> (VAT-exempt)</span>{/if}
		</div>
		<div class="tr-row tr-item-amount">
			<span>{l.quantity} x {peso(l.unitPriceCentavos)}</span>
			<span>{peso(l.amountCentavos)}</span>
		</div>
	{/each}

	<div class="tr-rule tr-dashed"></div>

	{#if vat && isInvoice}
		<div class="tr-row"><span>VATable sales</span><span>{peso(t.vatableSalesCentavos)}</span></div>
		<div class="tr-row"><span>VAT-exempt sales</span><span>{peso(t.vatExemptSalesCentavos)}</span></div>
		{#if t.zeroRatedSalesCentavos}
			<div class="tr-row"><span>Zero-rated sales</span><span>{peso(t.zeroRatedSalesCentavos)}</span></div>
		{/if}
		<div class="tr-row"><span>VAT (12%)</span><span>{peso(t.vatCentavos)}</span></div>
	{/if}
	<div class="tr-row tr-total-row">
		<span>{isReceipt ? 'AMOUNT PAID' : 'TOTAL'}</span><span>{peso(t.grossCentavos)}</span>
	</div>

	{#if isInvoice && t.lessPaymentsCentavos != null}
		<div class="tr-row"><span>Less: payments</span><span>{peso(t.lessPaymentsCentavos ?? 0)}</span></div>
		<div class="tr-row tr-total-row"><span>BALANCE DUE</span><span>{peso(t.balanceDueCentavos ?? 0)}</span></div>
	{/if}

	{#if isReceipt}
		<div class="tr-row"><span>Payment method</span><span>{t.paymentMethod ?? '—'}</span></div>
		{#if t.paymentReferenceNo}
			<div class="tr-row"><span>Reference no.</span><span>{t.paymentReferenceNo}</span></div>
		{/if}
		{#if t.tenderedCentavos != null}
			<div class="tr-row"><span>Cash tendered</span><span>{peso(t.tenderedCentavos)}</span></div>
			<div class="tr-row"><span>Change</span><span>{peso(t.changeCentavos ?? 0)}</span></div>
		{/if}
		{#if t.balanceCarriedCentavos != null}
			<div class="tr-row"><span>Balance c/f</span><span>{peso(t.balanceCarriedCentavos)}</span></div>
		{/if}
	{/if}

	<div class="tr-rule tr-dashed"></div>

	<div class="tr-label">Amount in words</div>
	<div class="tr-words">{snapshot.amountInWords}</div>

	<div class="tr-rule tr-dashed"></div>

	<div class="tr-sign">
		<div class="tr-sign-line"></div>
		<div class="tr-muted">{isReceipt ? 'Received payment by' : 'Prepared by'}</div>
	</div>
	<div class="tr-sign">
		<div class="tr-sign-line"></div>
		<div class="tr-muted">{isReceipt ? 'Payor / authorized rep.' : 'Authorized representative'}</div>
	</div>

	<div class="tr-rule tr-dashed"></div>

	<div class="tr-legal">
		{#if snapshot.bir.configured}
			<p>{permitLine}</p>
			{#if printerLine}<p>{printerLine}</p>{/if}
			{#if serialRangeLine}<p>{serialRangeLine}</p>{/if}
			{#if !vat}<p class="tr-legal-strong">NOT VALID FOR CLAIM OF INPUT TAX.</p>{/if}
			<p>Valid for five (5) years from the date of the permit to use.</p>
		{:else}
			<p class="tr-legal-strong">
				Computer-generated {doc.typeLabel.toLowerCase()} for the guest's reference — not a
				BIR-registered document.
			</p>
		{/if}
		{#if snapshot.bir.footerNote}<p>{snapshot.bir.footerNote}</p>{/if}
	</div>

	<div class="tr-close">Thank you for staying with us.</div>
</div>

<style>
	/* ---- Thermal Receipt (Accountable Forms world, monochrome continuous-roll variant)
	   Ink on white, no color (a thermal head can't print the A4 world's brick-red), so
	   the one emphasis move is bold-on-black for the doctype/serial block. Monospace
	   throughout — not just figures — since the whole point of this format is rigid
	   fixed-width columns at a 32-48 character budget; a proportional font would break
	   every row alignment (item amounts, totals ladder) that defines the genre. */
	.tr-page {
		/* A 203dpi thermal head reproduces thin strokes and true gray poorly — a
		   normal-weight #444 line prints faint next to a bold #000 one, which is
		   exactly what a real print test surfaced. So the whole page is solid ink
		   (no gray) at a heavier base weight; hierarchy comes from weight/size/
		   rules alone, the way an actual receipt already does it. */
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

	.tr-logo {
		display: block;
		max-height: 9mm;
		max-width: calc(var(--tr-width) - 10mm);
		margin: 0 auto 1.5mm;
		object-fit: contain;
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
		/* Was an inverted solid-black fill — on a thermal head that means burning
		   the full block area edge to edge, which is slow and burns through far
		   more paper/energy (and print-head wear) than a bordered outline of the
		   same size. A double-rule box reads just as "this is the important part"
		   without ever laying down a solid black region. */
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
	.tr-copy-tag {
		display: inline-block;
		margin-top: 1mm;
		padding: 0.3mm 1.5mm;
		font-size: 6.5pt;
		font-weight: 600;
		letter-spacing: 0.12em;
		border: 1px solid #000;
	}
	.tr-copy-tag.is-cancelled {
		font-weight: 700;
		font-size: 7.5pt;
		border-width: 1.5px;
		letter-spacing: 0.18em;
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
		/* Most values (dates, money) are short and stay on one line; a long one (a
		   multi-day stay-date range at 58mm) wraps instead of overflowing the roll. */
		min-width: 0;
		overflow-wrap: break-word;
	}

	.tr-label {
		font-size: 7pt;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--tr-muted);
		margin-top: 1mm;
	}
	.tr-value {
		font-size: 9pt;
		font-weight: 700;
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

	.tr-words {
		font-size: 8pt;
		font-weight: 600;
		margin-top: 0.5mm;
		word-wrap: break-word;
	}

	.tr-sign {
		margin-top: 4mm;
	}
	.tr-sign-line {
		border-top: 1px solid var(--tr-ink);
		width: 70%;
		margin: 0 auto 0.8mm;
	}
	.tr-sign .tr-muted {
		text-align: center;
		font-size: 7pt;
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
