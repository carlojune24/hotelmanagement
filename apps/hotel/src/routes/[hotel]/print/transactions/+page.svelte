<script lang="ts">
	import BookingTransactionsRegister from '$lib/components/print/booking-transactions-register.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Booking transactions — {data.range.from} to {data.range.to}</title>
</svelte:head>

<BookingTransactionsRegister
	rows={data.rows}
	range={data.range}
	q={data.q}
	hotelName={data.hotelName}
	hotelTin={data.hotelTin}
	printedAt={data.printedAt}
/>
