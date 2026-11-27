<script lang="ts" module>
	export type WalkInExtraLine = {
		key: number;
		amenityItemId?: string;
		description: string;
		quantity: number;
		unitPriceCentavos: number;
		/** Catalog items follow their own VAT flag; custom lines are never taxed. */
		taxable: boolean;
	};

	/** A line's price as the server will post it: quantity × price, plus VAT when the item is taxable. */
	export function extraLineTotal(x: WalkInExtraLine, vatRateBps: number): number {
		const sub = x.quantity * x.unitPriceCentavos;
		return sub + (x.taxable ? Math.round((sub * vatRateBps) / 10000) : 0);
	}

	/** The `extrasJson` the walk-in action reads. Catalog lines send only the id: the server re-prices them. */
	export function extrasJson(extras: WalkInExtraLine[]): string {
		return JSON.stringify(
			extras.map((x) =>
				x.amenityItemId
					? { amenityItemId: x.amenityItemId, quantity: x.quantity }
					: { description: x.description, quantity: x.quantity, unitPriceCentavos: x.unitPriceCentavos }
			)
		);
	}
</script>

<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let {
		extras = $bindable([]),
		options,
		vatRateBps,
		idPrefix = 'wi',
		note = 'Charged to the first room and paid with the booking.'
	}: {
		extras: WalkInExtraLine[];
		options: { id: string; name: string; priceCentavos: number; taxable: boolean }[];
		vatRateBps: number;
		idPrefix?: string;
		note?: string;
	} = $props();

	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	let key = 0;
	let customName = $state('');
	let customPrice = $state('');
	let customQty = $state('1');

	function addCatalog(item: (typeof options)[number]) {
		const hit = extras.find((x) => x.amenityItemId === item.id);
		if (hit) return void (hit.quantity = Math.min(999, hit.quantity + 1));
		extras.push({
			key: ++key,
			amenityItemId: item.id,
			description: item.name,
			quantity: 1,
			unitPriceCentavos: item.priceCentavos,
			taxable: item.taxable
		});
	}

	function addCustom() {
		const cents = Math.round(parseFloat(customPrice || '0') * 100);
		if (!customName.trim() || !(cents > 0)) return;
		extras.push({
			key: ++key,
			description: customName.trim(),
			quantity: Math.min(999, Math.max(1, Math.floor(Number(customQty) || 1))),
			unitPriceCentavos: cents,
			taxable: false
		});
		customName = '';
		customPrice = '';
		customQty = '1';
	}
</script>

<section class="space-y-2 rounded-lg border border-border p-3" aria-label="Extras">
	<h3 class="text-sm font-semibold text-ink">Extras</h3>
	{#if options.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each options as item (item.id)}
				<button
					type="button"
					onclick={() => addCatalog(item)}
					class="rounded border border-border px-2 py-1 text-xs hover:bg-surface-2"
				>
					+ {item.name} <span class="tabular-nums text-ink-muted">{peso(item.priceCentavos)}</span>
				</button>
			{/each}
		</div>
	{/if}
	{#each extras as x (x.key)}
		<div class="flex items-center gap-2 text-sm">
			<span class="min-w-0 flex-1 truncate text-ink">{x.description}</span>
			<Input
				type="number"
				min="1"
				max="999"
				step="1"
				bind:value={x.quantity}
				aria-label="Quantity of {x.description}"
				class="h-8 w-16 text-right"
			/>
			<span class="w-24 text-right tabular-nums text-ink">{peso(extraLineTotal(x, vatRateBps))}</span>
			<Button
				type="button"
				size="icon"
				variant="ghost"
				class="size-7 shrink-0"
				aria-label="Remove {x.description}"
				onclick={() => (extras = extras.filter((y) => y.key !== x.key))}
			>
				<XIcon class="size-3.5" />
			</Button>
		</div>
	{/each}
	<div class="flex items-end gap-2">
		<div class="min-w-0 flex-1">
			<Label for="{idPrefix}ExtraName" class="text-xs">Custom item</Label>
			<Input id="{idPrefix}ExtraName" bind:value={customName} placeholder="e.g. Extra breakfast" maxlength={160} />
		</div>
		<div class="w-16">
			<Label for="{idPrefix}ExtraQty" class="text-xs">Qty</Label>
			<Input id="{idPrefix}ExtraQty" type="number" min="1" max="999" step="1" bind:value={customQty} />
		</div>
		<div class="w-24">
			<Label for="{idPrefix}ExtraPrice" class="text-xs">Price (₱)</Label>
			<Input id="{idPrefix}ExtraPrice" type="number" min="0" step="0.01" bind:value={customPrice} />
		</div>
		<Button type="button" variant="outline" onclick={addCustom}>Add</Button>
	</div>
	<p class="text-xs text-ink-muted">{note}</p>
	<input type="hidden" name="extrasJson" value={extrasJson(extras)} />
</section>
