<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TransactionStatement from '$lib/components/print/transaction-statement.svelte';
	import { PAPER, type PaperKey } from '$lib/print-paper';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function pick(e: Event) {
		const url = new URL(page.url);
		url.searchParams.set('paper', (e.currentTarget as HTMLSelectElement).value);
		goto(url, { replaceState: true, keepFocus: true });
	}
</script>

<svelte:head><title>Booking Transaction {data.data.order.code}</title></svelte:head>

<label class="paper-pick">
	Paper
	<select value={data.paper} onchange={pick}>
		{#each Object.entries(PAPER) as [key, p] (key)}
			<option value={key as PaperKey}>{p.label}</option>
		{/each}
	</select>
</label>

<TransactionStatement data={data.data} printedAt={data.printedAt} paper={data.paper} />

<style>
	.paper-pick {
		display: flex;
		justify-content: center;
		gap: 8px;
		padding-bottom: 12px;
		color: #fff;
		font: 500 13px/1 'Inter Variable', system-ui, sans-serif;
	}
	/* The label's white text is inherited by the options, which open on a white list. */
	.paper-pick select {
		background: #fff;
		color: #1a1a1a;
		font: inherit;
		padding: 4px 8px;
	}
	@media print {
		.paper-pick {
			display: none;
		}
	}
</style>
