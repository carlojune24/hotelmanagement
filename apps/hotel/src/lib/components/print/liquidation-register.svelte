<script lang="ts">
	import type { LiquidationRegister } from '$lib/server/finance/documents';

	let {
		register,
		hotelName,
		hotelTin,
		printedAt
	}: {
		register: LiquidationRegister;
		hotelName: string;
		hotelTin: string | null;
		printedAt: string;
	} = $props();

	const peso = (c: number) =>
		`PHP ${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const s = $derived(register.series);
	const sum = $derived(register.summary);
	const typeLabel = $derived(s.type === 'invoice' ? 'Invoice' : 'Official Receipt');
</script>

<div class="lr-page">
	<div class="lr-frame">
		<header class="lr-head">
			<div>
				<div class="lr-hotel">{hotelName}</div>
				{#if hotelTin}<div class="lr-mono lr-sub">TIN {hotelTin}</div>{/if}
			</div>
			<div class="lr-title">
				<div class="lr-title-word">Inventory / Liquidation of Accountable Forms</div>
				<div class="lr-mono lr-sub">Printed {printedAt}</div>
			</div>
		</header>

		<div class="lr-rule"></div>

		<dl class="lr-meta">
			<div><dt>Document type</dt><dd>{typeLabel}</dd></div>
			<div><dt>Series</dt><dd class="lr-mono">{s.prefix} {s.serialFrom}–{s.serialTo}</dd></div>
			<div><dt>Range status</dt><dd>{s.status}</dd></div>
			<div><dt>Next serial</dt><dd class="lr-mono">{s.prefix} {s.nextSerial}</dd></div>
			{#if s.atpOrPermitNo}<div><dt>ATP / permit no.</dt><dd class="lr-mono">{s.atpOrPermitNo}</dd></div>{/if}
			{#if s.dateRegistered}<div><dt>Date registered</dt><dd class="lr-mono">{s.dateRegistered}</dd></div>{/if}
			{#if s.accreditedPrinter}<div><dt>Accredited printer</dt><dd>{s.accreditedPrinter}</dd></div>{/if}
			{#if s.accreditationNo}<div><dt>Accreditation no.</dt><dd class="lr-mono">{s.accreditationNo}</dd></div>{/if}
		</dl>

		<div class="lr-summary">
			<div><span>Issued</span><b class="lr-mono">{sum.issued}</b></div>
			<div><span>Cancelled</span><b class="lr-mono">{sum.cancelled}</b></div>
			<div><span>Spoiled</span><b class="lr-mono">{sum.spoiled}</b></div>
			<div><span>Unused</span><b class="lr-mono">{sum.unused}</b></div>
			<div><span>Range total</span><b class="lr-mono">{sum.total}</b></div>
		</div>

		<table class="lr-table">
			<thead>
				<tr>
					<th>Serial</th>
					<th>Status</th>
					<th>Issued / cancelled to</th>
					<th class="lr-num">Amount</th>
					<th>Date</th>
					<th>Recorded by</th>
					<th>Remarks</th>
				</tr>
			</thead>
			<tbody>
				{#each register.rows as r, i (i)}
					<tr>
						<td class="lr-mono">
							{#if r.count === 1}{r.formattedFrom}{:else}{r.formattedFrom}–{r.formattedTo} ({r.count}){/if}
						</td>
						<td class="lr-status-{r.status}">{r.status}</td>
						<td>{r.billToName ?? '—'}</td>
						<td class="lr-num lr-mono">{r.grossCentavos == null ? '—' : peso(r.grossCentavos)}</td>
						<td class="lr-mono">{r.at ? new Date(r.at).toISOString().slice(0, 10) : '—'}</td>
						<td>{r.byName ?? '—'}</td>
						<td>{r.reason ?? '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<section class="lr-signatures">
			<div><div class="lr-sign-line"></div>Prepared by</div>
			<div><div class="lr-sign-line"></div>Verified by</div>
		</section>
	</div>
</div>

<style>
	.lr-page {
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
		font-size: 9pt;
		line-height: 1.4;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.lr-page :global(*) {
		box-sizing: border-box;
	}
	.lr-frame {
		border: 3px double var(--af-ink);
		padding: 6mm;
	}
	.lr-mono {
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}
	.lr-head {
		display: flex;
		justify-content: space-between;
		gap: 10mm;
	}
	.lr-hotel {
		font-size: 13pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}
	.lr-title {
		text-align: right;
	}
	.lr-title-word {
		font-size: 10pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.lr-sub {
		font-size: 8pt;
		color: var(--af-ink-soft);
	}
	.lr-rule {
		height: 2px;
		background: var(--af-ink);
		margin: 4mm 0;
	}
	.lr-meta {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1mm 8mm;
		margin: 0 0 4mm;
	}
	.lr-meta div {
		display: flex;
		justify-content: space-between;
		gap: 4mm;
	}
	.lr-meta dt {
		color: var(--af-ink-soft);
	}
	.lr-meta dd {
		margin: 0;
		text-align: right;
	}
	.lr-summary {
		display: flex;
		gap: 4mm;
		margin-bottom: 4mm;
	}
	.lr-summary div {
		flex: 1;
		border: 1px solid var(--af-ink);
		padding: 2mm;
		text-align: center;
	}
	.lr-summary span {
		display: block;
		font-size: 7pt;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--af-ink-soft);
	}
	.lr-summary b {
		font-size: 12pt;
	}
	.lr-table {
		width: 100%;
		border-collapse: collapse;
	}
	.lr-table th,
	.lr-table td {
		padding: 1.2mm 2mm;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--af-rule);
	}
	.lr-table thead th {
		font-size: 7pt;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--af-ink-soft);
		border-bottom: 1px solid var(--af-ink);
	}
	.lr-num {
		text-align: right;
		white-space: nowrap;
	}
	.lr-status-cancelled {
		font-weight: 700;
	}
	.lr-status-unused,
	.lr-status-spoiled {
		color: var(--af-ink-soft);
	}
	.lr-table tbody tr {
		break-inside: avoid;
	}
	.lr-signatures {
		display: flex;
		gap: 14mm;
		margin-top: 12mm;
		font-size: 7.5pt;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--af-ink-soft);
	}
	.lr-signatures div {
		flex: 1;
		break-inside: avoid;
	}
	.lr-sign-line {
		border-top: 1px solid var(--af-ink);
		margin-bottom: 1mm;
	}

	@media screen {
		.lr-page {
			margin: 24px auto;
			border: 1px solid var(--af-rule);
		}
	}
	@page {
		size: A4;
		margin: 10mm;
	}
	@media print {
		.lr-page {
			margin: 0;
			padding: 0;
			width: auto;
			min-height: auto;
		}
	}
</style>
