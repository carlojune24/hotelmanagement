<script lang="ts">
	import AccountableForm from '$lib/components/print/accountable-form.svelte';
	import ThermalReceipt from '$lib/components/print/thermal-receipt.svelte';
	import FormatToggle from '$lib/components/print/format-toggle.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Invoices — {data.snapshots.length} item{data.snapshots.length === 1 ? '' : 's'}</title></svelte:head>

<FormatToggle format={data.format} />
{#each data.snapshots as snapshot, i (snapshot.document.formattedNo || i)}
	<div class="batch-invoice" class:not-first={i > 0}>
		{#if data.format === 'a4'}
			<AccountableForm {snapshot} logoUrl={data.logoUrl} />
		{:else}
			<ThermalReceipt {snapshot} logoUrl={data.logoUrl} widthMm={data.thermalPaperWidthMm} />
		{/if}
	</div>
{/each}

<style>
	@media print {
		.batch-invoice.not-first {
			break-before: page;
		}
	}
</style>
