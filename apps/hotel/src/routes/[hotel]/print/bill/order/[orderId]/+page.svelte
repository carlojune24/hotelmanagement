<script lang="ts">
	import { page } from '$app/state';
	import GuestBill from '$lib/components/print/guest-bill.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const autoPrint = $derived(page.url.searchParams.get('auto') === '1');
</script>

<svelte:head><title>Bill — {data.bill.where}</title></svelte:head>

<GuestBill
	hotelName={data.bill.hotel.name}
	where={data.bill.where}
	guestName={data.bill.guestName}
	printedAtIso={data.bill.printedAtIso}
	timezone={data.bill.timezone}
	lines={data.bill.lines}
	totalCentavos={data.bill.totalCentavos}
	widthMm={data.bill.widthMm}
	{autoPrint}
/>
