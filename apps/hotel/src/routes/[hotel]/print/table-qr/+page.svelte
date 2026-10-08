<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Table QR codes · {data.venueTitle}</title></svelte:head>

<div class="sheet">
	{#each data.tents as t (t.id)}
		<article class="tent">
			<p class="venue">{data.hotelName} · {data.venueTitle}</p>
			<p class="cta">Scan to see the menu<br />and order from your table</p>
			<div class="qr" role="img" aria-label="QR code for table {t.name}">{@html t.svg}</div>
			<p class="table">Table {t.name}</p>
			{#if t.area}<p class="area">{t.area}</p>{/if}
		</article>
	{:else}
		<p class="empty">No tables to print.</p>
	{/each}
</div>

<style>
	.sheet {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0;
		width: 210mm;
		min-height: 297mm;
		margin: 0 auto;
		background: #fff;
		color: #111;
		font-family: 'Inter Variable', system-ui, sans-serif;
	}
	.tent {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3mm;
		height: 148.5mm;
		padding: 10mm;
		border: 0.3mm dashed #999;
		text-align: center;
		break-inside: avoid;
	}
	.venue {
		font-size: 11pt;
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.cta {
		font-size: 10pt;
		color: #444;
		line-height: 1.35;
	}
	.qr {
		width: 62mm;
		height: 62mm;
	}
	.qr :global(svg) {
		width: 100%;
		height: 100%;
	}
	.table {
		font-size: 26pt;
		font-weight: 700;
		line-height: 1;
	}
	.area {
		font-size: 11pt;
		color: #444;
	}
	.empty {
		grid-column: 1 / -1;
		padding: 40mm 0;
		text-align: center;
	}
	@media print {
		@page {
			size: A4;
			margin: 0;
		}
		.sheet {
			width: 100%;
			min-height: 0;
		}
	}
</style>
