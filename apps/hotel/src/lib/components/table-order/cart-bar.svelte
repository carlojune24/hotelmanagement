<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { peso } from '$lib/dining-qr-ui';

	let { count, total, onopen }: { count: number; total: number; onopen: () => void } = $props();
</script>

<!-- The phone's cart: a floating bar within thumb's reach as soon as something is in it. Hidden on a wide screen, where the cart is the side panel. -->
<div class="tq-cartbar" role="region" aria-label="Your cart">
	<div class="tq-cartbar-inner">
		<p class="tq-cartbar-sum">
			<span class="tq-cartbar-count ledger-data" aria-hidden="true">{count}</span>
			<span>
				<span class="tq-cartbar-label sr-only">{count} {count === 1 ? 'item' : 'items'}, total</span>
				<span class="tq-cartbar-total">{peso(total)}</span>
			</span>
		</p>
		<button type="button" class="tq-cartbar-open" onclick={onopen}>
			View cart <ArrowRightIcon class="size-4" aria-hidden="true" />
		</button>
	</div>
</div>
