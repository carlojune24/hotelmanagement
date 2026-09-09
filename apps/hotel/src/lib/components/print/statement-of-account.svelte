<script lang="ts">
	import type { StatementOfAccount } from '$lib/server/finance/receivables';

	let { statement, printedAt }: { statement: StatementOfAccount; printedAt: string } = $props();

	const s = $derived(statement);
	const peso = (c: number) =>
		`PHP ${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const statusLabel: Record<string, string> = {
		open: 'Open',
		partial: 'Partially paid',
		settled: 'Settled',
		written_off: 'Written off'
	};
	// Enough ruled filler rows that a short statement still reads as stationery.
	const fillerRows = $derived(Math.max(0, 9 - s.lines.length));
</script>

<div class="soa-page">
	<div class="soa-frame">
		<header class="soa-head">
			<div class="soa-issuer">
				<div class="soa-name">{s.hotel.legalName || s.hotel.name}</div>
				{#if s.hotel.legalName && s.hotel.legalName !== s.hotel.name}
					<div class="soa-soft">operating as {s.hotel.name}</div>
				{/if}
				{#if s.hotel.address}<div class="soa-soft">{s.hotel.address}</div>{/if}
				<div class="soa-soft">
					{#if s.hotel.tin}<span class="soa-mono">TIN {s.hotel.tin}</span> · {/if}
					{s.hotel.isVatRegistered ? 'VAT-registered' : 'Non-VAT'}
				</div>
			</div>
			<div class="soa-title">
				<div class="soa-title-word">Statement of Account</div>
				{#if s.receivable.referenceNo}
					<div class="soa-mono soa-title-ref">Ref {s.receivable.referenceNo}</div>
				{/if}
			</div>
		</header>

		<div class="soa-rule"></div>

		<div class="soa-parties">
			<div class="soa-billto">
				<span class="soa-label">Bill to</span>
				{#if s.receivable.billToCompany}
					<div class="soa-party">{s.receivable.billToCompany}</div>
					<div class="soa-soft">Attn: {s.receivable.billToName}</div>
				{:else}
					<div class="soa-party">{s.receivable.billToName}</div>
				{/if}
				{#if s.receivable.notes}<div class="soa-soft soa-notes">{s.receivable.notes}</div>{/if}
			</div>
			<dl class="soa-meta">
				<div><dt>Statement date</dt><dd class="soa-mono">{s.statementDate}</dd></div>
				<div><dt>Account opened</dt><dd class="soa-mono">{s.receivable.openedOn}</dd></div>
				<div><dt>Days outstanding</dt><dd class="soa-mono">{s.daysOutstanding}</dd></div>
				<div><dt>Status</dt><dd>{statusLabel[s.receivable.status] ?? s.receivable.status}</dd></div>
			</dl>
		</div>

		<table class="soa-lines">
			<thead>
				<tr>
					<th>Description</th>
					<th class="soa-num">Qty</th>
					<th class="soa-num">Amount</th>
				</tr>
			</thead>
			<tbody>
				{#each s.lines as line (line.description + line.totalCentavos)}
					<tr>
						<td>{line.description}</td>
						<td class="soa-num soa-mono">{line.quantity}</td>
						<td class="soa-num soa-mono">{peso(line.totalCentavos)}</td>
					</tr>
				{/each}
				{#each Array(fillerRows) as _, i (i)}
					<tr class="soa-filler"><td>&nbsp;</td><td></td><td></td></tr>
				{/each}
			</tbody>
		</table>

		<div class="soa-fill"></div>

		<div class="soa-foot">
			<div class="soa-remit">
				{#if s.remittance}
					<span class="soa-label">Remit payment to</span>
					<div>{s.remittance.accountName}</div>
					{#if s.remittance.institution}<div class="soa-soft">{s.remittance.institution}</div>{/if}
					{#if s.remittance.accountRef}
						<div class="soa-soft soa-mono">Acct. {s.remittance.accountRef}</div>
					{/if}
				{:else}
					<span class="soa-label">Remit payment to</span>
					<div class="soa-soft">Contact the front office for payment details.</div>
				{/if}
			</div>
			<div class="soa-totals">
				{#if s.preSettledCentavos > 0}
					<div><span>Charges</span><span class="soa-mono">{peso(s.chargesTotalCentavos)}</span></div>
					<div class="soa-pay">
						<span>Less: settled at check-out</span
						><span class="soa-mono">−{peso(s.preSettledCentavos)}</span>
					</div>
					<div class="soa-sub">
						<span>Balance carried to this account</span
						><span class="soa-mono">{peso(s.receivable.originalCentavos)}</span>
					</div>
				{:else}
					<div>
						<span>Total charges</span><span class="soa-mono">{peso(s.chargesTotalCentavos)}</span>
					</div>
				{/if}
				{#each s.payments as p (p.date + p.amountCentavos)}
					<div class="soa-pay">
						<span>Payment received {p.date}</span><span class="soa-mono">−{peso(p.amountCentavos)}</span>
					</div>
				{/each}
				{#if s.paymentsTotalCentavos > 0}
					<div class="soa-sub">
						<span>Less: payments received</span
						><span class="soa-mono">−{peso(s.paymentsTotalCentavos)}</span>
					</div>
				{/if}
				<div class="soa-due">
					<span>Amount due</span><span class="soa-mono">{peso(s.receivable.outstandingCentavos)}</span>
				</div>
			</div>
		</div>

		<section class="soa-signatures">
			<div><div class="soa-sign-line"></div>Prepared by</div>
			<div><div class="soa-sign-line"></div>Authorized representative</div>
		</section>

		<p class="soa-legal">
			<span class="soa-legal-strong">This is a statement of account, not an Official Receipt.</span>
			An Official Receipt is issued upon payment. Please settle the amount due and quote the
			reference above on your remittance.
			{#if s.hotel.footerNote}<br />{s.hotel.footerNote}{/if}
			<br />This document is computer-generated and is not a BIR-registered accountable form.
			<span class="soa-mono">Printed {printedAt}.</span>
		</p>
	</div>
</div>

<style>
	.soa-page {
		--af-ink: #1a1a1a;
		--af-ink-soft: #55524c;
		--af-rule: #b7b2a8;
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
	.soa-page :global(*) {
		box-sizing: border-box;
	}
	.soa-frame {
		display: flex;
		flex-direction: column;
		border: 3px double var(--af-ink);
		padding: 6mm;
		min-height: calc(297mm - 20mm);
	}
	.soa-mono {
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}
	.soa-soft {
		font-size: 8.5pt;
		color: var(--af-ink-soft);
	}
	.soa-head {
		display: flex;
		justify-content: space-between;
		gap: 10mm;
	}
	.soa-name {
		font-size: 15pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}
	.soa-title {
		text-align: right;
		min-width: 62mm;
	}
	.soa-title-word {
		font-size: 13pt;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.soa-title-ref {
		font-size: 9pt;
		color: var(--af-ink-soft);
		margin-top: 1mm;
	}
	.soa-rule {
		height: 2px;
		background: var(--af-ink);
		margin: 4mm 0;
	}
	.soa-parties {
		display: flex;
		justify-content: space-between;
		gap: 10mm;
		margin-bottom: 4mm;
	}
	.soa-label {
		display: block;
		font-size: 7.5pt;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--af-ink-soft);
		margin-bottom: 1mm;
	}
	.soa-party {
		font-size: 11pt;
		font-weight: 600;
	}
	.soa-notes {
		margin-top: 1mm;
		max-width: 90mm;
	}
	.soa-meta {
		margin: 0;
		font-size: 8.5pt;
		min-width: 62mm;
	}
	.soa-meta div {
		display: flex;
		justify-content: space-between;
		gap: 4mm;
		padding: 0.4mm 0;
	}
	.soa-meta dt {
		color: var(--af-ink-soft);
	}
	.soa-meta dd {
		margin: 0;
		text-align: right;
	}
	.soa-lines {
		width: 100%;
		border-collapse: collapse;
	}
	.soa-lines th,
	.soa-lines td {
		padding: 1.6mm 2mm;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--af-rule);
	}
	.soa-lines thead th {
		font-size: 7.5pt;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--af-ink-soft);
		border-bottom: 1px solid var(--af-ink);
	}
	.soa-num {
		text-align: right;
		white-space: nowrap;
	}
	.soa-lines tbody tr {
		break-inside: avoid;
	}
	.soa-filler td {
		height: calc(1.6mm + 9.5pt);
	}
	.soa-fill {
		flex: 1;
		min-height: 8mm;
		background-image: repeating-linear-gradient(
			var(--af-rule) 0 1px,
			transparent 1px calc(1.6mm + 9.5pt)
		);
	}
	.soa-foot {
		display: flex;
		gap: 6mm;
		border-top: 1px solid var(--af-ink);
		padding-top: 3mm;
		margin-top: 3mm;
		break-inside: avoid;
	}
	.soa-remit {
		flex: 1;
		font-size: 9pt;
	}
	.soa-totals {
		width: 82mm;
	}
	.soa-totals > div {
		display: flex;
		justify-content: space-between;
		gap: 6mm;
		padding: 0.8mm 0;
		font-size: 9pt;
	}
	.soa-totals span:first-child {
		color: var(--af-ink-soft);
	}
	.soa-pay span:first-child,
	.soa-sub span:first-child {
		font-size: 8.5pt;
	}
	.soa-sub {
		border-top: 1px solid var(--af-rule);
	}
	.soa-due {
		border-top: 1px solid var(--af-ink);
		margin-top: 1mm;
		padding-top: 1.6mm !important;
		font-weight: 700;
	}
	.soa-due span:first-child {
		color: var(--af-ink) !important;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.soa-signatures {
		display: flex;
		gap: 14mm;
		margin-top: 10mm;
		font-size: 7.5pt;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--af-ink-soft);
	}
	.soa-signatures div {
		flex: 1;
		break-inside: avoid;
	}
	.soa-sign-line {
		border-top: 1px solid var(--af-ink);
		margin-bottom: 1mm;
	}
	.soa-legal {
		margin-top: 6mm;
		padding-top: 3mm;
		border-top: 1px solid var(--af-rule);
		font-size: 7.5pt;
		line-height: 1.5;
		color: var(--af-ink-soft);
		break-inside: avoid;
	}
	.soa-legal-strong {
		font-weight: 700;
		color: var(--af-ink);
	}

	@media screen {
		.soa-page {
			margin: 24px auto;
			border: 1px solid var(--af-rule);
		}
	}
	@page {
		size: A4;
		margin: 10mm;
	}
	@media print {
		.soa-page {
			margin: 0;
			padding: 0;
			width: auto;
			min-height: auto;
		}
	}
</style>
