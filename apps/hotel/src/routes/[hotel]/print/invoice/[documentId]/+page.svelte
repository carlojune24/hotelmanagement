<script lang="ts">
	import AccountableForm from '$lib/components/print/accountable-form.svelte';
	import ThermalReceipt from '$lib/components/print/thermal-receipt.svelte';
	import FormatToggle from '$lib/components/print/format-toggle.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.snapshot.document.typeLabel} {data.snapshot.document.formattedNo}</title></svelte:head>

<FormatToggle format={data.format} />
{#if data.format === 'a4'}
	<AccountableForm snapshot={data.snapshot} logoUrl={data.logoUrl} cancelled={data.cancelled} />
{:else}
	<ThermalReceipt
		snapshot={data.snapshot}
		logoUrl={data.logoUrl}
		cancelled={data.cancelled}
		widthMm={data.thermalPaperWidthMm}
	/>
{/if}
