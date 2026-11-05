<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const v = $derived(data.voucher);
	const peso = (c: number) => `PHP ${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
</script>

<svelte:head><title>{data.ota.name} voucher {data.ota.reference}</title></svelte:head>

<article class="ov-page">
	<header class="ov-head">
		<div>
			<div class="ov-muted">{data.hotelName}</div>
			<h1>{data.ota.name} booking voucher</h1>
		</div>
		<div class="ov-id">
			<div class="ov-muted">Booking ID</div>
			<strong>{data.ota.reference}</strong>
			{#if data.cancelled}<div class="ov-void">Cancelled / no-show</div>{/if}
		</div>
	</header>

	<dl class="ov-kv">
		<dt>Customer name</dt><dd>{data.guest.fullName}</dd>
		<dt>Country of residence</dt><dd>{v?.country ?? '—'}</dd>
		<dt>Check-in</dt><dd>{data.checkIn}</dd>
		<dt>Check-out</dt><dd>{data.checkOut}</dd>
		<dt>Other guests</dt><dd class="ov-pre">{v?.otherGuests ?? '—'}</dd>
		{#if data.guest.email}<dt>Email</dt><dd>{data.guest.email}</dd>{/if}
		{#if data.guest.phone}<dt>Phone</dt><dd>{data.guest.phone}</dd>{/if}
	</dl>

	<table class="ov-box">
		<thead><tr><th>Room type</th><th>No. of rooms</th><th>Occupancy</th><th>No. of extra bed</th></tr></thead>
		<tbody>
			{#each data.rooms as r (r.roomType)}
				<tr><td>{r.roomType}</td><td>{r.rooms}</td><td>{r.occupancy} Adult{r.occupancy === 1 ? '' : 's'}</td><td>{r.extraBeds}</td></tr>
			{/each}
		</tbody>
	</table>
	<div class="ov-box ov-pad">Rate plan name: {v?.ratePlanName ?? '—'}</div>

	<section class="ov-sec"><h2>Benefits included</h2><p>{v?.benefits ?? '—'}</p></section>
	<section class="ov-sec">
		<h2>Special requests <span class="ov-muted">(subject to availability upon arrival)</span></h2>
		<p class="ov-pre">{data.guest.specialRequests ?? '—'}</p>
	</section>
	<section class="ov-sec"><h2>Cancellation policy</h2><p class="ov-pre">{v?.cancellationPolicy ?? '—'}</p></section>

	<footer class="ov-foot">
		<div class="ov-net">
			<div>Net rate (incl. taxes & fees)</div>
			<strong>{peso(data.netCentavos)}</strong>
		</div>
		<div class="ov-pay">
			<div>Booked and payable by</div>
			<strong>{data.ota.name}</strong>
			<div class="ov-muted">Prepaid at the OTA: the guest pays nothing at the desk for the room.</div>
		</div>
	</footer>
</article>

<style>
	.ov-page {
		box-sizing: border-box;
		width: 210mm;
		max-width: 100%;
		margin: 0 auto;
		padding: 12mm;
		background: #fff;
		color: #1a1a1a;
		font: 10pt/1.45 'Inter Variable', 'Inter', system-ui, sans-serif;
	}
	.ov-page :global(*) {
		box-sizing: border-box;
	}
	.ov-muted {
		color: #55524c;
		font-size: 8.5pt;
	}
	.ov-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		border-bottom: 2px solid #1a1a1a;
		padding-bottom: 3mm;
		margin-bottom: 4mm;
	}
	h1 {
		margin: 0;
		font-size: 15pt;
	}
	.ov-id {
		text-align: right;
		font-family: 'JetBrains Mono Variable', monospace;
	}
	.ov-void {
		color: #a11;
		font-weight: 600;
	}
	.ov-kv {
		display: grid;
		grid-template-columns: 45mm 1fr;
		gap: 1mm 4mm;
		margin: 0 0 4mm;
	}
	.ov-kv dt {
		font-weight: 600;
	}
	.ov-kv dd {
		margin: 0;
	}
	.ov-pre {
		white-space: pre-line;
	}
	.ov-box {
		width: 100%;
		border: 2px solid #1a1a1a;
		border-collapse: collapse;
		margin-bottom: 2mm;
	}
	.ov-box th,
	.ov-box td {
		text-align: left;
		padding: 1mm 2mm;
	}
	.ov-box thead th {
		border-bottom: 1px solid #1a1a1a;
	}
	.ov-pad {
		padding: 1.5mm 2mm;
	}
	.ov-sec {
		border-top: 1px dotted #777;
		padding: 1.5mm 0;
	}
	.ov-sec h2 {
		margin: 0;
		font-size: 10pt;
	}
	.ov-sec p {
		margin: 1mm 0 0;
	}
	.ov-foot {
		display: grid;
		grid-template-columns: 1fr 1.4fr;
		gap: 4mm;
		margin-top: 6mm;
	}
	.ov-net,
	.ov-pay {
		border: 3px double #1a1a1a;
		padding: 3mm;
	}
	.ov-net strong {
		display: block;
		margin-top: 2mm;
		font-size: 14pt;
		font-variant-numeric: tabular-nums;
	}
	@media print {
		.ov-page {
			width: auto;
			padding: 0;
		}
	}
</style>
