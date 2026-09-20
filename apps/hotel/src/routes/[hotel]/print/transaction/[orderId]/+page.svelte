<script lang="ts">
	import TransactionStatement from '$lib/components/print/transaction-statement.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Booking Transaction {data.data.order.code}</title></svelte:head>

<TransactionStatement data={data.data} printedAt={data.printedAt} />
