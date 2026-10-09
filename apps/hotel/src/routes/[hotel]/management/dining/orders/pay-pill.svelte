<script lang="ts">
	import { paymentLabel } from '$lib/orders-board';

	let {
		order,
		withMethod = true
	}: {
		order: { paymentStatus: string; paymentMethod: string | null; roomLabel: string | null };
		withMethod?: boolean;
	} = $props();

	const unpaid = $derived(order.paymentStatus === 'unpaid');
</script>

<!-- Text carries the meaning; colour only reinforces it. -->
<span
	class="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium {unpaid
		? 'bg-danger/10 text-danger'
		: 'bg-surface-2 text-ink-muted'}"
>
	{paymentLabel(order, withMethod)}
</span>
