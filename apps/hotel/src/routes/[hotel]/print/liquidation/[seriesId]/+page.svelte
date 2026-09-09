<script lang="ts">
	import LiquidationRegister from '$lib/components/print/liquidation-register.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Liquidation — {data.register.series.prefix} {data.register.series.serialFrom}–{data.register.series.serialTo}</title>
</svelte:head>

<LiquidationRegister
	register={data.register}
	hotelName={data.hotelName}
	hotelTin={data.hotelTin}
	printedAt={data.printedAt}
/>
