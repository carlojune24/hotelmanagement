<script lang="ts">
	import AccountableForm from '$lib/components/print/accountable-form.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.snapshot.document.typeLabel} {data.snapshot.document.formattedNo}</title></svelte:head>

<AccountableForm snapshot={data.snapshot} logoUrl={data.logoUrl} />
