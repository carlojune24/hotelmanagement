<script lang="ts">
	import { page } from '$app/state';
	import SaleReceipt from '$lib/components/print/sale-receipt.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const autoPrint = $derived(page.url.searchParams.get('auto') === '1');
</script>

<svelte:head>
	<title>{data.saleRef} — receipt</title>
</svelte:head>

<SaleReceipt
	hotel={data.hotel}
	saleRef={data.saleRef}
	issuedAtIso={data.issuedAtIso}
	method={data.method}
	lines={data.lines}
	totalCentavos={data.totalCentavos}
	tenderedCentavos={data.tenderedCentavos}
	changeCentavos={data.changeCentavos}
	widthMm={data.widthMm}
	{autoPrint}
/>
