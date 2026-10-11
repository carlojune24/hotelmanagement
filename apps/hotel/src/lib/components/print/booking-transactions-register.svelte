<script lang="ts">
	import type { BookingTransactionExportRow } from '$lib/server/booking-transactions';

	let {
		rows,
		range,
		q,
		hotelName,
		hotelTin,
		printedAt
	}: {
		rows: BookingTransactionExportRow[];
		range: { from: string; to: string };
		q: string;
		hotelName: string;
		hotelTin: string | null;
		printedAt: string;
	} = $props();

	const peso = (c: number) =>
		`PHP ${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const STATUS: Record<string, string> = {
		confirmed: 'Confirmed',
		in_house: 'In house',
		checked_out: 'Checked out',
		cancelled: 'Cancelled'
	};
	const sum = (pick: (r: BookingTransactionExportRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
	const rangeLabel = $derived(range.from === range.to ? range.from : `${range.from} to ${range.to}`);
</script>

<div class="bt-page">
	<header class="bt-head">
		<div>
			<div class="bt-hotel">{hotelName}</div>
			{#if hotelTin}<div class="bt-mono bt-sub">TIN {hotelTin}</div>{/if}
		</div>
		<div class="bt-title">
			<div class="bt-title-word">Booking transactions</div>
			<div class="bt-mono bt-sub">{rangeLabel}{q ? ` · search “${q}”` : ''}</div>
			<div class="bt-mono bt-sub">Printed {printedAt}</div>
		</div>
	</header>

	<div class="bt-summary">
		<div><span>Bookings</span><b class="bt-mono">{rows.length}</b></div>
		<div><span>Charges</span><b class="bt-mono">{peso(sum((r) => r.chargesCentavos))}</b></div>
		<div><span>Paid</span><b class="bt-mono">{peso(sum((r) => r.paidCentavos))}</b></div>
		<div><span>Still owed</span><b class="bt-mono">{peso(sum((r) => Math.max(0, r.balanceCentavos)))}</b></div>
	</div>

	<table class="bt-table">
		<thead>
			<tr>
				<th>Code</th>
				<th>Guest</th>
				<th>Rooms / events</th>
				<th>Stay</th>
				<th>Status</th>
				<th>Source</th>
				<th>Paid by</th>
				<th class="bt-num">Charges</th>
				<th class="bt-num">Paid</th>
				<th class="bt-num">Balance</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.orderId)}
				<tr>
					<td class="bt-mono">{r.code}</td>
					<td>{r.guestName}</td>
					<td>{r.roomLabel}</td>
					<td class="bt-mono">{r.checkIn}{r.checkOut && r.checkOut !== r.checkIn ? ` → ${r.checkOut}` : ''}</td>
					<td class:bt-cancelled={r.status === 'cancelled'}>{STATUS[r.status]}</td>
					<td>{r.source}</td>
					<td>
						{r.methods.join(', ') || '—'}
						{#if r.references.length}<div class="bt-mono bt-sub">{r.references.join(', ')}</div>{/if}
					</td>
					<td class="bt-num bt-mono">{peso(r.chargesCentavos)}</td>
					<td class="bt-num bt-mono">{peso(r.paidCentavos)}</td>
					<td class="bt-num bt-mono">{peso(r.balanceCentavos)}</td>
				</tr>
			{:else}
				<tr><td colspan="10" class="bt-empty">No bookings with a room or event in this range.</td></tr>
			{/each}
		</tbody>
	</table>

	<section class="bt-signatures">
		<div><div class="bt-sign-line"></div>Prepared by</div>
		<div><div class="bt-sign-line"></div>Verified by</div>
	</section>
</div>

<style>
	.bt-page {
		--bt-ink: #1a1a1a;
		--bt-ink-soft: #55524c;
		--bt-rule: #b7b2a8;
		box-sizing: border-box;
		width: 297mm;
		min-height: 210mm;
		margin: 0 auto;
		padding: 10mm;
		background: #fff;
		color: var(--bt-ink);
		font-family: 'Inter Variable', 'Inter', system-ui, sans-serif;
		font-size: 8.5pt;
		line-height: 1.35;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.bt-page :global(*) {
		box-sizing: border-box;
	}
	.bt-mono {
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}
	.bt-head {
		display: flex;
		justify-content: space-between;
		gap: 10mm;
		border-bottom: 2px solid var(--bt-ink);
		padding-bottom: 3mm;
		margin-bottom: 4mm;
	}
	.bt-hotel {
		font-size: 13pt;
		font-weight: 700;
		text-transform: uppercase;
	}
	.bt-title {
		text-align: right;
	}
	.bt-title-word {
		font-size: 11pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.bt-sub {
		font-size: 7.5pt;
		color: var(--bt-ink-soft);
	}
	.bt-summary {
		display: flex;
		gap: 4mm;
		margin-bottom: 4mm;
	}
	.bt-summary div {
		flex: 1;
		border: 1px solid var(--bt-ink);
		padding: 2mm;
		text-align: center;
	}
	.bt-summary span {
		display: block;
		font-size: 7pt;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--bt-ink-soft);
	}
	.bt-summary b {
		font-size: 11pt;
	}
	.bt-table {
		width: 100%;
		border-collapse: collapse;
	}
	.bt-table th,
	.bt-table td {
		padding: 1.2mm 2mm;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--bt-rule);
	}
	.bt-table thead th {
		font-size: 7pt;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--bt-ink-soft);
		border-bottom: 1px solid var(--bt-ink);
	}
	.bt-table thead {
		display: table-header-group;
	}
	.bt-table tbody tr {
		break-inside: avoid;
	}
	.bt-num {
		text-align: right;
		white-space: nowrap;
	}
	.bt-cancelled {
		font-weight: 700;
	}
	.bt-empty {
		text-align: center;
		color: var(--bt-ink-soft);
		padding: 8mm 0;
	}
	.bt-signatures {
		display: flex;
		gap: 14mm;
		margin-top: 12mm;
		font-size: 7.5pt;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--bt-ink-soft);
	}
	.bt-signatures div {
		flex: 1;
		break-inside: avoid;
	}
	.bt-sign-line {
		border-top: 1px solid var(--bt-ink);
		margin-bottom: 1mm;
	}
	@media screen {
		.bt-page {
			margin: 24px auto;
			border: 1px solid var(--bt-rule);
		}
	}
	@page {
		size: A4 landscape;
		margin: 10mm;
	}
	@media print {
		.bt-page {
			margin: 0;
			padding: 0;
			width: auto;
			min-height: auto;
		}
	}
</style>
