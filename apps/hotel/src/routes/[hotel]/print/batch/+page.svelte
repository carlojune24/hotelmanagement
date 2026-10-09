<script lang="ts">
	import { page } from '$app/state';
	import AccountableForm from '$lib/components/print/accountable-form.svelte';
	import ThermalReceipt from '$lib/components/print/thermal-receipt.svelte';
	import FormatToggle from '$lib/components/print/format-toggle.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const autoPrint = $derived(page.url.searchParams.get('auto') === '1');

	// Thermal: every document on one continuous strip, so a table of three orders is one print job and
	// one dialog. This page owns the single `@page` (the receipts are told not to), sized to the
	// strip; the same measuring trick the receipt component uses on its own.
	let stripEl = $state<HTMLDivElement>();
	let stripHeightMm = $state(200);
	const PX_TO_MM = 25.4 / 96;
	function measure() {
		if (!stripEl) return;
		const px = stripEl.getBoundingClientRect().height;
		if (px > 0) stripHeightMm = Math.ceil(px * PX_TO_MM) + 2;
	}
	let printed = false;
	$effect(() => {
		if (data.format !== 'thermal' || !stripEl) return;
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(stripEl);
		window.addEventListener('beforeprint', measure);
		return () => {
			ro.disconnect();
			window.removeEventListener('beforeprint', measure);
		};
	});
	$effect(() => {
		if (!autoPrint || printed) return;
		printed = true;
		// Two frames: let the @page size and layout flush before the dialog grabs the page.
		requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
	});
	const first = $derived(data.docs[0]?.snapshot.document);
</script>

<svelte:head>
	<title>{data.docs.length === 1 && first ? `${first.typeLabel} ${first.formattedNo}` : `${data.docs.length} documents`}</title>
	{#if data.format === 'thermal'}
		<style>{`@page { size: ${data.thermalPaperWidthMm}mm ${stripHeightMm}mm; margin: 0; }`}</style>
	{/if}
</svelte:head>

<FormatToggle format={data.format} />

{#if data.format === 'a4'}
	{#each data.docs as d, i (i)}
		<div class="batch-sheet">
			<AccountableForm snapshot={d.snapshot} logoUrl={data.logoUrl} cancelled={d.cancelled} />
		</div>
	{/each}
{:else}
	<div bind:this={stripEl} class="batch-strip">
		{#each data.docs as d, i (i)}
			{#if i > 0}<div class="batch-cut" aria-hidden="true">- - - - - - - - cut here - - - - - - - -</div>{/if}
			<ThermalReceipt snapshot={d.snapshot} logoUrl={data.logoUrl} cancelled={d.cancelled} widthMm={data.thermalPaperWidthMm} managePage={false} />
		{/each}
	</div>
{/if}

<style>
	.batch-sheet {
		break-after: page;
	}
	.batch-sheet:last-child {
		break-after: auto;
	}
	.batch-strip {
		width: fit-content;
		margin: 0 auto;
	}
	.batch-cut {
		text-align: center;
		font: 500 7pt/1 'JetBrains Mono Variable', ui-monospace, monospace;
		color: #000;
		padding: 1.5mm 0;
		white-space: nowrap;
		overflow: hidden;
	}
	@media screen {
		.batch-cut {
			color: #777;
		}
	}
</style>
