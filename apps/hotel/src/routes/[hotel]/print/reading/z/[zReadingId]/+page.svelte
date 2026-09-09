<script lang="ts">
	import ReadingSlip from '$lib/components/print/reading-slip.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Z-Reading No. {data.reading.zCounter} — {data.reading.businessDate}</title></svelte:head>

<ReadingSlip reading={data.reading} printedAt={data.printedAt} />
