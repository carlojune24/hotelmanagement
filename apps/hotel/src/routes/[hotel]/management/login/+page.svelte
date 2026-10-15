<script lang="ts">
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Sign in · {data.hotelName}</title></svelte:head>

<AuthShell
	brandName={data.hotelName}
	logoUrl={data.logoUrl}
	photoUrl={data.photoUrl}
	headline={data.hotelName}
	blurb="Sign in to manage bookings, the front desk, dining and finance for this hotel."
	note="Staff access only."
	next={data.next}
	error={form?.error ?? null}
/>
