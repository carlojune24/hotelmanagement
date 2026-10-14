<script lang="ts">
	import ReportSheet from '$lib/components/print/report-sheet.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Trail — {data.ref}</title>
</svelte:head>

<ReportSheet doc={data.doc} hotelName={data.hotelName} hotelTin={data.hotelTin} printedAt={data.printedAt} preparedBy={data.preparedBy} />
