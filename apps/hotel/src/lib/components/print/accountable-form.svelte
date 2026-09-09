<script lang="ts">
	import type { DocumentSnapshot } from '$lib/server/finance/documents';

	let {
		snapshot,
		logoUrl = null,
		accent = null,
		cancelled = false
	}: {
		snapshot: DocumentSnapshot;
		logoUrl?: string | null;
		accent?: string | null;
		cancelled?: boolean;
	} = $props();

	const peso = (c: number) =>
		`PHP ${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

	// Footer lines are assembled here so spacing survives Svelte's whitespace trimming.
	const permitLine = $derived(
		[
			`Permit / ATP No. ${snapshot.bir.permitNo ?? '—'}`,
			snapshot.bir.permitDateIssued ? `issued ${snapshot.bir.permitDateIssued}` : null
		]
			.filter(Boolean)
			.join(' · ') + '.'
	);
	const printerLine = $derived(
		snapshot.bir.accreditedPrinter
			? `Printed by ${snapshot.bir.accreditedPrinter}` +
					(snapshot.bir.accreditationNo
						? ` (Accreditation No. ${snapshot.bir.accreditationNo}).`
						: '.')
			: null
	);
	const serialRangeLine = $derived(
		snapshot.bir.serialRange
			? `Authorized serial range ${snapshot.bir.serialRange.prefix} ${snapshot.bir.serialRange.from}–${snapshot.bir.serialRange.to}.`
			: null
	);
	const t = $derived(snapshot.totals);
	const vat = $derived(snapshot.hotel.isVatRegistered);
</script>

<div class="af-page" style={accent ? `--af-accent:${accent}` : undefined}>
	<div class="af-frame">
		<header class="af-head">
			<div class="af-letterhead">
				{#if logoUrl}
					<img class="af-logo" src={logoUrl} alt="" />
				{/if}
				<div class="af-hotel-name">{snapshot.hotel.legalName || snapshot.hotel.name}</div>
				{#if snapshot.hotel.legalName && snapshot.hotel.legalName !== snapshot.hotel.name}
					<div class="af-hotel-trade">operating as {snapshot.hotel.name}</div>
				{/if}
				{#if snapshot.hotel.address}
					<div class="af-hotel-line">{snapshot.hotel.address}</div>
				{/if}
				<div class="af-hotel-line af-mono">
					{#if snapshot.hotel.tin}TIN {snapshot.hotel.tin} &nbsp;·&nbsp; {/if}
					{vat ? 'VAT REGISTERED' : 'NON-VAT REGISTERED'}
				</div>
			</div>

			<div class="af-serial">
				<div class="af-doctype">{doc.typeLabel}</div>
				<div class="af-serial-no af-mono">No. {doc.formattedNo || '—'}</div>
				<div
					class="af-copy-tag"
					class:is-reprint={doc.isReprint && !cancelled}
					class:is-cancelled={cancelled}
				>
					{cancelled ? 'CANCELLED' : doc.isReprint ? 'REPRINT' : 'ORIGINAL'}
				</div>
				<dl class="af-serial-meta">
					<div><dt>Date issued</dt><dd class="af-mono">{fmtDateTime(doc.issuedAtIso)}</dd></div>
					<div><dt>Business date</dt><dd class="af-mono">{doc.businessDate}</dd></div>
					{#if doc.preparedBy}
						<div><dt>Prepared by</dt><dd>{doc.preparedBy}</dd></div>
					{/if}
				</dl>
			</div>
		</header>

		<div class="af-accent-rule"></div>

		<section class="af-parties">
			<div>
				<div class="af-label">{isReceipt ? 'Received from' : 'Bill to'}</div>
				<div class="af-value">{snapshot.billTo.name ?? '—'}</div>
				{#if snapshot.billTo.address}<div class="af-sub">{snapshot.billTo.address}</div>{/if}
				{#if snapshot.billTo.tin}<div class="af-sub af-mono">TIN {snapshot.billTo.tin}</div>{/if}
			</div>
			<div class="af-ref">
				{#if snapshot.reference.appliedToInvoiceNo}
					<div><span class="af-label">Applied to invoice</span> <span class="af-mono">{snapshot.reference.appliedToInvoiceNo}</span></div>
				{/if}
				{#if snapshot.reference.bookingRef}
					<div><span class="af-label">Booking</span> <span class="af-mono">{snapshot.reference.bookingRef}</span></div>
				{/if}
				{#if snapshot.reference.stayDates}
					<div><span class="af-label">Dates</span> <span class="af-mono">{snapshot.reference.stayDates}</span></div>
				{/if}
				{#if snapshot.reference.folioRef}
					<div><span class="af-label">Folio</span> <span class="af-mono">{snapshot.reference.folioRef}</span></div>
				{/if}
				{#if snapshot.reference.orderRef}
					<div><span class="af-label">Order</span> <span class="af-mono">{snapshot.reference.orderRef}</span></div>
				{/if}
			</div>
		</section>

		<table class="af-lines">
			<thead>
				<tr>
					<th>Description</th>
					<th class="af-num">Qty</th>
					<th class="af-num">Unit price</th>
					<th class="af-num">Amount</th>
				</tr>
			</thead>
			<tbody>
				{#each snapshot.lines as l, i (i)}
					<tr>
						<td>
							{l.description}
							{#if isInvoice && vat && !l.vatable}<span class="af-exempt"> (VAT-exempt)</span>{/if}
						</td>
						<td class="af-num af-mono">{l.quantity}</td>
						<td class="af-num af-mono">{peso(l.unitPriceCentavos)}</td>
						<td class="af-num af-mono">{peso(l.amountCentavos)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div class="af-lines-fill" aria-hidden="true"></div>

		<section class="af-foot-grid">
			<div class="af-words">
				<div class="af-label">Amount in words</div>
				<div class="af-words-value af-mono">{snapshot.amountInWords}</div>
			</div>

			<dl class="af-totals">
				{#if vat && isInvoice}
					<div><dt>VATable sales</dt><dd class="af-mono">{peso(t.vatableSalesCentavos)}</dd></div>
					<div><dt>VAT-exempt sales</dt><dd class="af-mono">{peso(t.vatExemptSalesCentavos)}</dd></div>
					{#if t.zeroRatedSalesCentavos}
						<div><dt>Zero-rated sales</dt><dd class="af-mono">{peso(t.zeroRatedSalesCentavos)}</dd></div>
					{/if}
					<div><dt>VAT (12%)</dt><dd class="af-mono">{peso(t.vatCentavos)}</dd></div>
				{/if}
				<div class="af-total-line">
					<dt>{isReceipt ? 'Amount paid' : 'Total'}</dt>
					<dd class="af-mono">{peso(t.grossCentavos)}</dd>
				</div>

				{#if isInvoice}
					<div><dt>Less: payments received</dt><dd class="af-mono">{peso(t.lessPaymentsCentavos ?? 0)}</dd></div>
					<div class="af-total-line">
						<dt>Balance due</dt>
						<dd class="af-mono">{peso(t.balanceDueCentavos ?? 0)}</dd>
					</div>
				{/if}

				{#if isReceipt}
					<div><dt>Payment method</dt><dd>{t.paymentMethod ?? '—'}</dd></div>
					{#if t.paymentReferenceNo}
						<div><dt>Reference no.</dt><dd class="af-mono">{t.paymentReferenceNo}</dd></div>
					{/if}
					{#if t.tenderedCentavos != null}
						<div><dt>Cash tendered</dt><dd class="af-mono">{peso(t.tenderedCentavos)}</dd></div>
						<div><dt>Change</dt><dd class="af-mono">{peso(t.changeCentavos ?? 0)}</dd></div>
					{/if}
					{#if t.balanceCarriedCentavos != null}
						<div><dt>Balance carried forward</dt><dd class="af-mono">{peso(t.balanceCarriedCentavos)}</dd></div>
					{/if}
				{/if}
			</dl>
		</section>

		<section class="af-signatures">
			<div class="af-sign">
				<div class="af-sign-line"></div>
				<div class="af-label">{isReceipt ? 'Received payment by' : 'Prepared by'}</div>
			</div>
			<div class="af-sign">
				<div class="af-sign-line"></div>
				<div class="af-label">{isReceipt ? 'Payor / authorized representative' : 'Authorized representative'}</div>
			</div>
		</section>

		<footer class="af-legal">
			{#if snapshot.bir.configured}
				<p>{permitLine}{#if printerLine}&nbsp;{printerLine}{/if}</p>
				{#if serialRangeLine}<p>{serialRangeLine}</p>{/if}
				{#if !vat}
					<p class="af-legal-strong">THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</p>
				{/if}
				<p>
					This {doc.typeLabel.toLowerCase()} shall be valid for five (5) years from the date of the
					permit to use.
				</p>
			{:else}
				<p class="af-legal-strong">
					Computer-generated {doc.typeLabel.toLowerCase()} for the guest's reference. This is not a
					BIR-registered document. Set the hotel's BIR details in Finance → BIR → Setup to issue a
					compliant document.
				</p>
			{/if}
			{#if snapshot.bir.footerNote}
				<p>{snapshot.bir.footerNote}</p>
			{/if}
		</footer>
	</div>
</div>

<style>
	/* ---- The "Accountable Form" world ---------------------------------------
	   Ink on white, one brick-red for the serial + document type, fine
	   double-rule frame, Inter for structure, JetBrains Mono for every figure.
	   No serif, no shadow, no rounded corners. Prints and photocopies clean. */
	.af-page {
		--af-ink: #1a1a1a;
		--af-ink-soft: #55524c;
		--af-rule: #b7b2a8;
		--af-red: #a3272e;
		--af-accent: var(--af-ink);
		box-sizing: border-box;
		width: 210mm;
		min-height: 297mm;
		margin: 0 auto;
		padding: 10mm;
		background: #fff;
		color: var(--af-ink);
		font-family: 'Inter Variable', 'Inter', system-ui, sans-serif;
		font-size: 10pt;
		line-height: 1.4;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.af-page :global(*) {
		box-sizing: border-box;
	}
	.af-frame {
		border: 3px double var(--af-ink);
		padding: 6mm;
		min-height: calc(297mm - 20mm);
		display: flex;
		flex-direction: column;
	}
	.af-mono {
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}

	/* Header */
	.af-head {
		display: flex;
		justify-content: space-between;
		gap: 10mm;
	}
	.af-logo {
		max-height: 16mm;
		max-width: 55mm;
		margin-bottom: 2mm;
		object-fit: contain;
	}
	.af-hotel-name {
		font-size: 15pt;
		font-weight: 700;
		letter-spacing: 0.01em;
		text-transform: uppercase;
	}
	.af-hotel-trade {
		font-size: 9pt;
		color: var(--af-ink-soft);
	}
	.af-hotel-line {
		font-size: 8.5pt;
		color: var(--af-ink-soft);
		margin-top: 0.5mm;
	}
	.af-serial {
		text-align: right;
		min-width: 62mm;
	}
	.af-doctype {
		font-size: 13pt;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--af-red);
	}
	.af-serial-no {
		font-size: 13pt;
		font-weight: 700;
		color: var(--af-red);
		margin-top: 1mm;
	}
	.af-copy-tag {
		display: inline-block;
		margin-top: 1.5mm;
		padding: 0.5mm 2mm;
		font-size: 7.5pt;
		letter-spacing: 0.14em;
		color: var(--af-ink-soft);
		border: 1px solid var(--af-rule);
	}
	.af-copy-tag.is-reprint {
		color: var(--af-ink);
		border-color: var(--af-ink);
	}
	.af-copy-tag.is-cancelled {
		color: var(--af-ink);
		border: 1.5px solid var(--af-ink);
		font-weight: 700;
		letter-spacing: 0.18em;
	}
	.af-serial-meta {
		margin: 3mm 0 0;
		font-size: 8.5pt;
	}
	.af-serial-meta div {
		display: flex;
		justify-content: flex-end;
		gap: 3mm;
	}
	.af-serial-meta dt {
		color: var(--af-ink-soft);
	}
	.af-serial-meta dd {
		margin: 0;
		min-width: 34mm;
		text-align: right;
	}

	.af-accent-rule {
		height: 2px;
		background: var(--af-accent);
		margin: 4mm 0;
	}

	/* Parties */
	.af-parties {
		display: flex;
		justify-content: space-between;
		gap: 10mm;
		margin-bottom: 4mm;
	}
	.af-label {
		font-size: 7.5pt;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--af-ink-soft);
	}
	.af-value {
		font-size: 11pt;
		font-weight: 600;
	}
	.af-sub {
		font-size: 8.5pt;
		color: var(--af-ink-soft);
	}
	.af-ref {
		text-align: right;
		font-size: 8.5pt;
	}
	.af-ref > div {
		margin-top: 0.5mm;
	}

	/* Line items */
	.af-lines {
		width: 100%;
		border-collapse: collapse;
	}
	/* Ruled filler so a sparse invoice still reads as a full pre-printed form
	   instead of leaving a blank void above the totals. */
	.af-lines-fill {
		flex: 1;
		min-height: 12mm;
		background-image: repeating-linear-gradient(
			to bottom,
			transparent 0,
			transparent calc(1.6mm + 9.5pt),
			var(--af-rule) calc(1.6mm + 9.5pt),
			var(--af-rule) calc(1.6mm + 9.5pt + 1px)
		);
	}
	.af-lines th,
	.af-lines td {
		padding: 1.6mm 2mm;
		text-align: left;
		vertical-align: top;
	}
	.af-lines thead th {
		font-size: 7.5pt;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--af-ink-soft);
		border-bottom: 1px solid var(--af-ink);
	}
	.af-lines tbody td {
		border-bottom: 1px solid var(--af-rule);
		font-size: 9.5pt;
	}
	.af-num {
		text-align: right;
		white-space: nowrap;
	}
	.af-exempt {
		font-size: 8pt;
		color: var(--af-ink-soft);
	}

	/* Footer grid: amount-in-words box + totals ladder */
	.af-foot-grid {
		display: flex;
		gap: 6mm;
		padding-top: 4mm;
		border-top: 1px solid var(--af-ink);
	}
	/* Never split a bill fact, the totals ladder, or a signature block across a page break. */
	.af-foot-grid,
	.af-words,
	.af-signatures,
	.af-legal,
	.af-lines tbody tr {
		break-inside: avoid;
	}
	.af-words {
		flex: 1;
		border: 1px solid var(--af-ink);
		padding: 2.5mm 3mm;
	}
	.af-words-value {
		margin-top: 1.5mm;
		font-size: 9.5pt;
		font-weight: 500;
	}
	.af-totals {
		width: 78mm;
		margin: 0;
		font-size: 9pt;
	}
	.af-totals div {
		display: flex;
		justify-content: space-between;
		gap: 4mm;
		padding: 0.8mm 0;
	}
	.af-totals dt {
		color: var(--af-ink-soft);
	}
	.af-totals dd {
		margin: 0;
		text-align: right;
	}
	.af-total-line {
		border-top: 1px solid var(--af-ink);
		margin-top: 0.8mm;
		padding-top: 1.4mm !important;
		font-weight: 700;
	}
	.af-total-line dt {
		color: var(--af-ink) !important;
	}

	/* Signatures */
	.af-signatures {
		display: flex;
		gap: 14mm;
		margin-top: 10mm;
	}
	.af-sign {
		flex: 1;
	}
	.af-sign-line {
		border-top: 1px solid var(--af-ink);
		margin-bottom: 1mm;
	}

	/* Legal / disclaimer footer */
	.af-legal {
		margin-top: 6mm;
		padding-top: 3mm;
		border-top: 1px solid var(--af-rule);
		font-size: 7.5pt;
		line-height: 1.5;
		color: var(--af-ink-soft);
	}
	.af-legal p {
		margin: 0 0 1mm;
	}
	.af-legal-strong {
		font-weight: 700;
		color: var(--af-ink);
		letter-spacing: 0.02em;
	}

	@media screen {
		.af-page {
			margin: 24px auto;
			border: 1px solid var(--af-rule);
		}
	}
	/* The real print/PDF page: A4 with the ~10mm margin the on-screen `.af-page`
	   padding stands in for. A matching-margin Playwright `pdf()` call (or
	   `preferCSSPageSize: true`) keeps the double-rule frame off the sheet edge. */
	@page {
		size: A4;
		margin: 10mm;
	}
	@media print {
		.af-page {
			margin: 0;
			padding: 0;
			width: auto;
			min-height: auto;
		}
		.af-frame {
			/* Fill the printable area (A4 minus the @page margins) so the ruled
			   filler reads as a pre-printed form on paper, not only on screen. */
			min-height: 265mm;
		}
	}
</style>
