<script lang="ts">
	import type { ReadingView } from '$lib/server/finance/readings';

	let { reading, printedAt }: { reading: ReadingView; printedAt: string } = $props();

	const peso = (c: number) =>
		`PHP ${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const methodLabel: Record<string, string> = {
		cash: 'Cash',
		card: 'Card',
		gcash: 'GCash',
		maya: 'Maya',
		bank_transfer: 'Bank transfer',
		cheque: 'Cheque',
		paymongo: 'Online (PayMongo)',
		house_use: 'City ledger'
	};
	const r = $derived(reading);
	const tenders = $derived(Object.entries(r.tenderBreakdown).sort((a, b) => b[1] - a[1]));
	const fmtTs = (iso: string) => new Date(iso).toLocaleString('en-PH', {
		year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
	});
</script>

<div class="rs-page">
	<div class="rs-frame">
		<header class="rs-head">
			<div>
				<div class="rs-hotel">{r.hotelName}</div>
				{#if r.hotelTin}<div class="rs-mono rs-sub">TIN {r.hotelTin}</div>{/if}
				<div class="rs-mono rs-sub">{r.isVatRegistered ? 'VAT REGISTERED' : 'NON-VAT REGISTERED'}</div>
			</div>
			<div class="rs-title">
				<div class="rs-title-word">{r.kind === 'z' ? 'Z-Reading' : 'X-Reading'}</div>
				{#if r.kind === 'z'}<div class="rs-mono rs-title-no">No. {r.zCounter}</div>{/if}
			</div>
		</header>

		<div class="rs-rule"></div>

		<dl class="rs-meta">
			<div><dt>Business date</dt><dd class="rs-mono">{r.businessDate}</dd></div>
			<div><dt>{r.kind === 'z' ? 'Closed' : 'Generated'}</dt><dd class="rs-mono">{fmtTs(r.generatedAt)}</dd></div>
			<div><dt>Printed</dt><dd class="rs-mono">{printedAt}</dd></div>
			{#if r.kind === 'x'}
				<div><dt>Type</dt><dd>Interim — counters not reset</dd></div>
			{/if}
		</dl>

		<div class="rs-spans">
			<div>
				<span class="rs-label">Invoices</span>
				<span class="rs-mono">
					{#if r.invoiceCount}{r.invoiceBeginNo} – {r.invoiceEndNo} ({r.invoiceCount}){:else}none{/if}
				</span>
			</div>
			<div>
				<span class="rs-label">Official Receipts</span>
				<span class="rs-mono">
					{#if r.orCount}{r.orBeginNo} – {r.orEndNo} ({r.orCount}){:else}none{/if}
				</span>
			</div>
		</div>

		<table class="rs-table">
			<tbody>
				{#if r.isVatRegistered}
					<tr><td>VATable sales</td><td class="rs-num rs-mono">{peso(r.vatableSalesCentavos)}</td></tr>
					<tr><td>VAT-exempt sales</td><td class="rs-num rs-mono">{peso(r.vatExemptSalesCentavos)}</td></tr>
					{#if r.zeroRatedSalesCentavos}
						<tr><td>Zero-rated sales</td><td class="rs-num rs-mono">{peso(r.zeroRatedSalesCentavos)}</td></tr>
					{/if}
					<tr><td>VAT</td><td class="rs-num rs-mono">{peso(r.vatCentavos)}</td></tr>
				{:else}
					<tr><td>Sales (non-VAT)</td><td class="rs-num rs-mono">{peso(r.vatExemptSalesCentavos)}</td></tr>
				{/if}
				<tr class="rs-strong"><td>Gross sales</td><td class="rs-num rs-mono">{peso(r.grossSalesCentavos)}</td></tr>
				<tr><td>Less: SC / PWD discount</td><td class="rs-num rs-mono">{peso(r.scPwdDiscountCentavos)}</td></tr>
				<tr><td>Less: other discount</td><td class="rs-num rs-mono">{peso(r.otherDiscountCentavos)}</td></tr>
				<tr class="rs-strong"><td>Net sales</td><td class="rs-num rs-mono">{peso(r.netSalesCentavos)}</td></tr>
				<tr><td>Voids / cancellations ({r.voidCount})</td><td class="rs-num rs-mono">{peso(r.voidAmountCentavos)}</td></tr>
				<tr><td>Refunds ({r.refundCount})</td><td class="rs-num rs-mono">{peso(r.refundAmountCentavos)}</td></tr>
			</tbody>
		</table>

		<div class="rs-grand">
			<div><span>Old grand total</span><b class="rs-mono">{peso(r.prevGrandTotalCentavos)}</b></div>
			<div><span>+ Net sales{r.kind === 'x' ? ' (so far)' : ''}</span><b class="rs-mono">{peso(r.netSalesCentavos)}</b></div>
			<div class="rs-grand-new"><span>{r.kind === 'z' ? 'New grand total' : 'Projected grand total'}</span><b class="rs-mono">{peso(r.newGrandTotalCentavos)}</b></div>
		</div>

		<table class="rs-table">
			<thead><tr><th>Tender</th><th class="rs-num">Amount</th></tr></thead>
			<tbody>
				{#if tenders.length === 0}
					<tr><td colspan="2" class="rs-sub">No payments recorded.</td></tr>
				{:else}
					{#each tenders as [m, amt] (m)}
						<tr><td>{methodLabel[m] ?? m}</td><td class="rs-num rs-mono">{peso(amt)}</td></tr>
					{/each}
				{/if}
			</tbody>
		</table>

		<section class="rs-signatures">
			<div><div class="rs-sign-line"></div>Prepared by</div>
			<div><div class="rs-sign-line"></div>Verified by</div>
		</section>

		{#if r.kind === 'x'}
			<p class="rs-legal">
				This is an interim (X) reading for reference only. It does not reset any counter and is not
				the day's official sales record.
			</p>
		{/if}
	</div>
</div>

<style>
	.rs-page {
		--af-ink: #1a1a1a;
		--af-ink-soft: #55524c;
		--af-rule: #b7b2a8;
		--af-red: #a3272e;
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
	.rs-page :global(*) {
		box-sizing: border-box;
	}
	.rs-frame {
		border: 3px double var(--af-ink);
		padding: 6mm;
		max-width: 150mm;
		margin: 0 auto;
	}
	.rs-mono {
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}
	.rs-head {
		display: flex;
		justify-content: space-between;
		gap: 8mm;
	}
	.rs-hotel {
		font-size: 13pt;
		font-weight: 700;
		text-transform: uppercase;
	}
	.rs-sub {
		font-size: 8pt;
		color: var(--af-ink-soft);
	}
	.rs-title {
		text-align: right;
	}
	.rs-title-word {
		font-size: 13pt;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--af-red);
	}
	.rs-title-no {
		font-size: 12pt;
		font-weight: 700;
		color: var(--af-red);
	}
	.rs-rule {
		height: 2px;
		background: var(--af-ink);
		margin: 4mm 0;
	}
	.rs-meta {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1mm 8mm;
		margin: 0 0 4mm;
		font-size: 8.5pt;
	}
	.rs-meta div {
		display: flex;
		justify-content: space-between;
		gap: 4mm;
	}
	.rs-meta dt {
		color: var(--af-ink-soft);
	}
	.rs-meta dd {
		margin: 0;
		text-align: right;
	}
	.rs-label {
		display: block;
		font-size: 7.5pt;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--af-ink-soft);
	}
	.rs-spans {
		display: flex;
		gap: 8mm;
		margin-bottom: 4mm;
		font-size: 8.5pt;
	}
	.rs-spans > div {
		flex: 1;
	}
	.rs-table {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 4mm;
	}
	.rs-table th,
	.rs-table td {
		padding: 1.2mm 2mm;
		text-align: left;
		border-bottom: 1px solid var(--af-rule);
	}
	.rs-table thead th {
		font-size: 7pt;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--af-ink-soft);
		border-bottom: 1px solid var(--af-ink);
	}
	.rs-num {
		text-align: right;
		white-space: nowrap;
	}
	.rs-strong td {
		font-weight: 700;
		border-top: 1px solid var(--af-ink);
	}
	.rs-grand {
		border: 1px solid var(--af-ink);
		padding: 3mm;
		margin-bottom: 4mm;
		break-inside: avoid;
	}
	.rs-grand div {
		display: flex;
		justify-content: space-between;
		gap: 6mm;
		padding: 0.6mm 0;
		font-size: 9pt;
	}
	.rs-grand span {
		color: var(--af-ink-soft);
	}
	.rs-grand-new {
		border-top: 1px solid var(--af-ink);
		margin-top: 1mm;
		padding-top: 1.6mm !important;
		font-weight: 700;
	}
	.rs-grand-new span {
		color: var(--af-ink) !important;
	}
	.rs-signatures {
		display: flex;
		gap: 14mm;
		margin-top: 10mm;
		font-size: 7.5pt;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--af-ink-soft);
	}
	.rs-signatures div {
		flex: 1;
		break-inside: avoid;
	}
	.rs-sign-line {
		border-top: 1px solid var(--af-ink);
		margin-bottom: 1mm;
	}
	.rs-legal {
		margin-top: 6mm;
		padding-top: 3mm;
		border-top: 1px solid var(--af-rule);
		font-size: 7.5pt;
		line-height: 1.5;
		color: var(--af-ink-soft);
	}

	@media screen {
		.rs-page {
			margin: 24px auto;
			border: 1px solid var(--af-rule);
		}
	}
	@page {
		size: A4;
		margin: 10mm;
	}
	@media print {
		.rs-page {
			margin: 0;
			padding: 0;
			width: auto;
			min-height: auto;
		}
	}
</style>
