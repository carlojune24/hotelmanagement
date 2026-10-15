<script lang="ts">
	import AuthShell from '$lib/components/auth/AuthShell.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Sign in · MM Group</title></svelte:head>

<AuthShell
	brandName="MM Group"
	logoUrl={data.logoUrl}
	photoUrl={data.photoUrl}
	blurb="Sign in to manage your hotel's bookings, front desk, dining and finance."
	note="Staff access only."
	next={data.next}
	error={form?.error ?? null}
	backHref="/"
	backLabel="Back to hotels"
/>
