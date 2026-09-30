<script lang="ts">
	import TicketPercentIcon from '@lucide/svelte/icons/ticket-percent';

	type Promo = {
		code: string;
		terms: string | null;
		grossCentavos: number;
		discountCentavos: number;
		effectiveBps: number;
		netCentavos: number;
	};

	let { promo }: { promo: Promo } = $props();

	const peso = (c: number) => `₱${(c / 100).toFixed(2)}`;
	const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
</script>

<!-- Trail of an online-booking promo code: the room's price before the code, the discount taken,
     and what the folio actually charges — so management can trace why the stay line is lower. -->
<div class="rounded-md border border-border bg-surface-2 p-2.5 text-sm">
	<div class="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
		<TicketPercentIcon class="size-4 text-ok" />
		<span class="font-semibold text-ink">Promo code applied</span>
		<span class="rounded border border-border bg-surface px-1.5 font-mono text-xs text-ink">
			{promo.code}
		</span>
		{#if promo.terms}
			<span class="text-xs text-ink-muted">{promo.terms}</span>
		{/if}
	</div>
	<div class="space-y-1 tabular-nums">
		<div class="flex items-center justify-between gap-2">
			<span class="text-ink-muted">Room price before promo</span>
			<span class="text-ink">{peso(promo.grossCentavos)}</span>
		</div>
		<div class="flex items-center justify-between gap-2">
			<span class="text-ink-muted">
				Promo discount
				<span class="text-xs">({pct(promo.effectiveBps)} of this room)</span>
			</span>
			<span class="text-ok">−{peso(promo.discountCentavos)}</span>
		</div>
		<div class="flex items-center justify-between gap-2 border-t border-border pt-1 font-semibold">
			<span class="text-ink">Charged for the stay</span>
			<span class="text-ink">{peso(promo.netCentavos)}</span>
		</div>
	</div>
	<p class="mt-1.5 text-xs text-ink-muted">
		The room-stay line below is this discounted amount; the discount is already taken off, not
		owed again.
	</p>
</div>
