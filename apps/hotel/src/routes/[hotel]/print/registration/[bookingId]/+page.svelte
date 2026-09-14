<script lang="ts">
	import RegistrationCard from '$lib/components/print/registration-card.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Guest Registration Card — {data.data.guest.fullName}</title></svelte:head>

<RegistrationCard data={data.data} printedAt={data.printedAt} />
