<script lang="ts">
	import type { DocCell, DocColumn, ReportDoc } from '$lib/dining-report-doc';

	let {
		doc,
		hotelName,
		hotelTin,
		printedAt,
		preparedBy
	}: {
		doc: ReportDoc;
		hotelName: string;
		hotelTin: string | null;
		printedAt: string;
		preparedBy: string;
	} = $props();

	const fmt = (c: number) =>
		(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	// Rows show a dash for a zero so a column of amounts scans; totals always show the figure.
	const show = (v: DocCell, col: DocColumn, isTotal = false) => {
		if (col.kind === 'money' && typeof v === 'number') return v === 0 && !isTotal ? '—' : fmt(v);
		return String(v ?? '');
	};
	const summaryValue = (s: ReportDoc['summary'][number]) => (s.kind === 'money' ? `PHP ${fmt(s.value)}` : String(s.value));
	const numeric = (col: DocColumn) => col.kind !== 'text';
	// Fixed column widths so the amounts line up from one table to the next.
	const width = (col: DocColumn) =>
		col.kind === 'money' ? '30mm' : col.kind === 'int' ? '20mm' : col.label === 'Date and time' ? '37mm' : col.label === 'Date' ? '28mm' : undefined;
</script>

<div class="rs-page">
	<header class="rs-head">
		<div>
			<div class="rs-hotel">{hotelName}</div>
			{#if hotelTin}<div class="rs-mono rs-sub">TIN {hotelTin}</div>{/if}
		</div>
		<div class="rs-title">
			<div class="rs-title-word">{doc.title}</div>
			<div class="rs-mono rs-sub">{doc.periodLabel ?? 'Period'}: {doc.period}</div>
			<div class="rs-mono rs-sub">Printed {printedAt}</div>
		</div>
	</header>

	<dl class="rs-meta">
		{#each doc.meta as [k, v] (k)}
			<div><dt>{k}</dt><dd>{v}</dd></div>
		{/each}
	</dl>

	<div class="rs-summary">
		{#each doc.summary as s (s.label)}
			<div><span>{s.label}</span><b class="rs-mono">{summaryValue(s)}</b></div>
		{/each}
	</div>

	{#each doc.sections as sec (sec.title)}
		<section class="rs-section">
			<h2>{sec.title}</h2>
			<table class="rs-table">
				<thead>
					<tr>
						{#each sec.columns as col (col.label)}
							<th class:rs-num={numeric(col)} style:width={width(col)}>{col.label}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each sec.rows as row, ri (ri)}
						<tr>
							{#each row as v, i (i)}
								<td class:rs-num={numeric(sec.columns[i]!)} class:rs-mono={numeric(sec.columns[i]!) || sec.columns[i]!.label === 'Date' || sec.columns[i]!.label === 'Date and time'}>
									{show(v, sec.columns[i]!)}
								</td>
							{/each}
						</tr>
					{:else}
						<tr><td colspan={sec.columns.length} class="rs-empty">{sec.emptyText ?? 'None.'}</td></tr>
					{/each}
				</tbody>
				{#if sec.total && sec.rows.length > 0}
					<tfoot>
						<tr>
							{#each sec.total as v, i (i)}
								<td class:rs-num={numeric(sec.columns[i]!)} class:rs-mono={numeric(sec.columns[i]!)}>{show(v, sec.columns[i]!, true)}</td>
							{/each}
						</tr>
					</tfoot>
				{/if}
			</table>
			{#if sec.note}<p class="rs-note">{sec.note}</p>{/if}
		</section>
	{/each}

	<section class="rs-basis">
		<h2>Basis of preparation</h2>
		<ol>
			{#each doc.notes as n (n)}<li>{n}</li>{/each}
		</ol>
	</section>

	<section class="rs-signatures">
		<div><div class="rs-sign-name">{preparedBy}</div><div class="rs-sign-line"></div>Prepared by</div>
		<div><div class="rs-sign-name">&nbsp;</div><div class="rs-sign-line"></div>Reviewed by</div>
		<div><div class="rs-sign-name">&nbsp;</div><div class="rs-sign-line"></div>Approved by</div>
	</section>
</div>

<style>
	.rs-page {
		--rs-ink: #1a1a1a;
		--rs-ink-soft: #55524c;
		--rs-rule: #b7b2a8;
		box-sizing: border-box;
		width: 210mm;
		min-height: 297mm;
		margin: 0 auto;
		padding: 10mm;
		background: #fff;
		color: var(--rs-ink);
		font-family: 'Inter Variable', 'Inter', system-ui, sans-serif;
		font-size: 8.5pt;
		line-height: 1.35;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.rs-page :global(*) {
		box-sizing: border-box;
	}
	.rs-mono {
		font-family: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
	}
	.rs-head {
		display: flex;
		justify-content: space-between;
		gap: 10mm;
		border-bottom: 2px solid var(--rs-ink);
		padding-bottom: 3mm;
		margin-bottom: 3mm;
	}
	.rs-hotel {
		font-size: 13pt;
		font-weight: 700;
		text-transform: uppercase;
	}
	.rs-title {
		text-align: right;
	}
	.rs-title-word {
		font-size: 11pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.rs-sub {
		font-size: 7.5pt;
		color: var(--rs-ink-soft);
	}
	.rs-meta {
		margin: 0 0 4mm;
		font-size: 8pt;
	}
	.rs-meta div {
		display: flex;
		gap: 3mm;
	}
	.rs-meta dt {
		width: 18mm;
		flex: none;
		color: var(--rs-ink-soft);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-size: 7pt;
		padding-top: 0.4mm;
	}
	.rs-meta dd {
		margin: 0;
	}
	.rs-summary {
		display: flex;
		gap: 3mm;
		margin-bottom: 5mm;
	}
	.rs-summary div {
		flex: 1;
		border: 1px solid var(--rs-ink);
		padding: 2mm;
		text-align: center;
		break-inside: avoid;
	}
	.rs-summary span {
		display: block;
		font-size: 6.5pt;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--rs-ink-soft);
		min-height: 2.6em;
	}
	.rs-summary b {
		font-size: 9.5pt;
	}
	.rs-section {
		margin-bottom: 3.5mm;
	}
	h2 {
		margin: 0 0 1.5mm;
		font-size: 8.5pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		break-after: avoid;
	}
	.rs-table {
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
	}
	.rs-table td {
		overflow-wrap: anywhere;
	}
	.rs-table th,
	.rs-table td {
		padding: 1mm 2mm;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid var(--rs-rule);
	}
	.rs-table thead th {
		font-size: 7pt;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--rs-ink-soft);
		border-bottom: 1px solid var(--rs-ink);
	}
	.rs-table thead {
		display: table-header-group;
	}
	.rs-table tbody tr,
	.rs-table tfoot tr {
		break-inside: avoid;
	}
	.rs-table tfoot td {
		font-weight: 700;
		border-top: 1px solid var(--rs-ink);
		border-bottom: 2px solid var(--rs-ink);
	}
	.rs-num {
		text-align: right !important;
		white-space: nowrap;
	}
	.rs-empty {
		text-align: center !important;
		color: var(--rs-ink-soft);
		padding: 5mm 0 !important;
	}
	.rs-note {
		margin: 1mm 0 0;
		font-size: 7pt;
		color: var(--rs-ink-soft);
	}
	.rs-basis {
		margin-top: 4mm;
		border-top: 1px solid var(--rs-rule);
		padding-top: 2mm;
		break-inside: avoid;
	}
	.rs-basis ol {
		margin: 0;
		padding-left: 5mm;
		list-style: decimal;
		font-size: 7.5pt;
		color: var(--rs-ink-soft);
	}
	.rs-signatures {
		display: flex;
		gap: 12mm;
		margin-top: 9mm;
		font-size: 7.5pt;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--rs-ink-soft);
		break-inside: avoid;
	}
	.rs-signatures > div {
		flex: 1;
	}
	.rs-sign-name {
		min-height: 5mm;
		text-transform: none;
		letter-spacing: 0;
		font-size: 8.5pt;
		color: var(--rs-ink);
	}
	.rs-sign-line {
		border-top: 1px solid var(--rs-ink);
		margin-bottom: 1mm;
	}
	@media screen {
		.rs-page {
			margin: 24px auto;
			border: 1px solid var(--rs-rule);
		}
	}
	@page {
		size: A4 portrait;
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
