<script lang="ts">
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';
	import { tableChip } from '$lib/orders-board';

	let {
		label,
		orderType,
		tone = 'ink',
		size = 'md'
	}: {
		label: string | null;
		orderType: string;
		/** `ok` for food waiting at the pass; `ink` for everything still in the kitchen. */
		tone?: 'ok' | 'ink';
		size?: 'sm' | 'md';
	} = $props();

	const text = $derived(tableChip(label));
</script>

<span
	class="inline-flex shrink-0 items-center justify-center rounded-lg font-semibold tabular-nums {size === 'md'
		? 'size-12 text-base'
		: 'size-10 text-sm'} {tone === 'ok' ? 'bg-ok text-white' : 'bg-ink text-surface'}"
	aria-hidden="true"
>
	{#if text}
		{text}
	{:else if orderType === 'takeaway'}
		<ShoppingBagIcon class={size === 'md' ? 'size-5' : 'size-4'} />
	{:else}
		<UtensilsIcon class={size === 'md' ? 'size-5' : 'size-4'} />
	{/if}
</span>
