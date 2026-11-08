<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { computeDiningDiscount, type DiningDiscountKind } from '$lib/dining-discount';

	/**
	 * The discount picker shared by Take payment and Settle: None / Senior·PWD / Staff, and for SC/PWD
	 * each qualifying guest's name + OSCA/PWD ID and how many dined. Posts `discountKind`, `claimants`
	 * (JSON) and `diners`, read by `parseDiscount` in `lib/server/dining-check-actions.ts`. Rates come
	 * from the Dining layout (Dining settings → Discounts).
	 */
	let {
		orders,
		off = false,
		discount = $bindable(null),
		ready = $bindable(true)
	}: {
		/** The orders being paid; the preview is worked out per order then summed, like the server. */
		orders: { totalCentavos: number; vatCentavos: number }[];
		/** True for a room charge: the discount goes on the room bill there, not here. */
		off?: boolean;
		/** Out: the discounted amount and what came off, or null when no discount applies. */
		discount?: { net: number; less: number; label: string } | null;
		/** Out: false while an SC/PWD discount is missing a name, an ID or the diner count. */
		ready?: boolean;
	} = $props();

	const rates = $derived((page.data as { discountRates?: { scPwdBps: number; staffBps: number } }).discountRates ?? { scPwdBps: 0, staffBps: 0 });
	const pct = (bps: number) => `${bps / 100}%`;

	let picked = $state<'none' | DiningDiscountKind>('none');
	let claimants = $state<{ name: string; idNumber: string }[]>([{ name: '', idNumber: '' }]);
	let diners = $state('');

	// The toggle can be cleared to '', which means none.
	const kind = $derived(off || !picked ? 'none' : picked);
	const dinersN = $derived(Math.floor(Number(diners)) || 0);

	$effect(() => {
		const scPwdOk = claimants.every((c) => c.name.trim() && c.idNumber.trim()) && dinersN >= claimants.length;
		ready = kind !== 'sc_pwd' || scPwdOk;
		if (kind === 'none' || (kind === 'sc_pwd' && dinersN < claimants.length)) {
			discount = null;
			return;
		}
		const bps = kind === 'staff' ? rates.staffBps : rates.scPwdBps;
		let less = 0;
		let net = 0;
		for (const o of orders) {
			const r = computeDiningDiscount(o, kind, bps, claimants.length, Math.max(dinersN, 1));
			less += r.discountCentavos + r.vatRemovedCentavos;
			net += r.netCentavos;
		}
		discount = { net, less, label: kind === 'sc_pwd' ? 'senior / PWD discount and VAT' : 'staff discount' };
	});
</script>

<input type="hidden" name="discountKind" value={kind} />
{#if !off && (rates.scPwdBps > 0 || rates.staffBps > 0)}
	<div>
		<Label class="text-xs">Discount</Label>
		<ToggleGroup.Root type="single" bind:value={picked} variant="outline" class="mt-1 w-full">
			<ToggleGroup.Item value="none" class="flex-1">None</ToggleGroup.Item>
			{#if rates.scPwdBps > 0}
				<ToggleGroup.Item value="sc_pwd" class="flex-1">Senior / PWD {pct(rates.scPwdBps)}</ToggleGroup.Item>
			{/if}
			{#if rates.staffBps > 0}
				<ToggleGroup.Item value="staff" class="flex-1">Staff {pct(rates.staffBps)}</ToggleGroup.Item>
			{/if}
		</ToggleGroup.Root>
	</div>
{/if}

{#if kind === 'sc_pwd'}
	<fieldset class="space-y-2 rounded-lg border border-border p-3">
		<legend class="px-1 text-xs text-ink-muted">Senior / PWD guests</legend>
		<input type="hidden" name="claimants" value={JSON.stringify(claimants)} />
		{#each claimants as c, i (i)}
			<div class="flex items-end gap-2">
				<div class="min-w-0 flex-1">
					<Label for="claimantName{i}" class="text-xs">Name</Label>
					<Input id="claimantName{i}" bind:value={c.name} maxlength={160} autocomplete="off" class="mt-1" />
				</div>
				<div class="min-w-0 flex-1">
					<Label for="claimantId{i}" class="text-xs">OSCA / PWD ID no.</Label>
					<Input id="claimantId{i}" bind:value={c.idNumber} maxlength={60} autocomplete="off" class="mt-1" />
				</div>
				{#if claimants.length > 1}
					<Button type="button" variant="ghost" size="sm" aria-label="Remove guest {i + 1}" onclick={() => (claimants = claimants.filter((_, j) => j !== i))}>Remove</Button>
				{/if}
			</div>
		{/each}
		<Button type="button" variant="outline" size="sm" onclick={() => (claimants = [...claimants, { name: '', idNumber: '' }])}>Add another guest</Button>
		<div>
			<Label for="discountDiners" class="text-xs">Diners in all</Label>
			<Input id="discountDiners" name="diners" type="number" inputmode="numeric" min={claimants.length} step="1" bind:value={diners} class="mt-1 w-28 tabular-nums" />
			<p class="mt-1 text-xs text-ink-muted">
				Only their share ({claimants.length} of {dinersN || '?'}) is VAT-exempt and gets {pct(rates.scPwdBps)} off. For one person eating alone, enter 1.
			</p>
		</div>
	</fieldset>
{/if}
