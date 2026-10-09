<script lang="ts">
	import BanIcon from '@lucide/svelte/icons/ban';
	import BellRingIcon from '@lucide/svelte/icons/bell-ring';
	import ChefHatIcon from '@lucide/svelte/icons/chef-hat';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import SendIcon from '@lucide/svelte/icons/send';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';
	import { statusShort, statusTone } from '$lib/dining-qr-ui';

	let { status }: { status: string } = $props();
	const tone = $derived(statusTone(status));
</script>

<!-- A status is always an icon and a word in its colour, never the colour alone. -->
<span class="tq-status tone-{tone}">
	{#if status === 'pending_acceptance'}<ClockIcon class="size-4" aria-hidden="true" />
	{:else if tone === 'sent'}<SendIcon class="size-4" aria-hidden="true" />
	{:else if tone === 'preparing'}<ChefHatIcon class="size-4" aria-hidden="true" />
	{:else if tone === 'ready'}<BellRingIcon class="size-4" aria-hidden="true" />
	{:else if tone === 'served'}<UtensilsIcon class="size-4" aria-hidden="true" />
	{:else}<BanIcon class="size-4" aria-hidden="true" />{/if}
	{statusShort(status)}
</span>
