<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
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
	type Claimant = { type: 'senior_citizen' | 'pwd'; name: string; idNumber: string };
	const blank = (): Claimant => ({ type: 'senior_citizen', name: '', idNumber: '' });
	let claimants = $state<Claimant[]>([blank()]);
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
	<fieldset class="space-y-1.5">
		<legend class="text-xs font-medium text-ink">Senior / PWD guests</legend>
		<input type="hidden" name="claimants" value={JSON.stringify(claimants)} />
		<div class="divide-y divide-border overflow-hidden rounded-lg border border-border">
			<!-- How many dined decides the share the discount covers, so it comes first. -->
			<div class="bg-surface-2/50 px-3 py-2.5">
				<div class="flex items-center justify-between gap-3">
					<Label for="discountDiners" class="text-sm">Diners at the table</Label>
					<Input id="discountDiners" name="diners" type="number" inputmode="numeric" min={claimants.length} step="1" bind:value={diners} class="h-8 w-20 text-right tabular-nums" />
				</div>
				<p class="mt-1 text-xs text-ink-muted" aria-live="polite">
					{#if dinersN >= claimants.length}
						{claimants.length} of {dinersN} share is VAT-exempt and gets {pct(rates.scPwdBps)} off.
					{:else}
						Enter how many dined, at least {claimants.length}. For one person eating alone, enter 1.
					{/if}
				</p>
			</div>

			{#each claimants as c, i (i)}
				<div class="space-y-2 px-3 py-2.5">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium text-ink">Guest {i + 1}</span>
						<ToggleGroup.Root type="single" value={c.type} onValueChange={(v) => v && (c.type = v as Claimant['type'])} variant="outline" size="sm" class="ml-auto w-36" aria-label="Guest {i + 1} is a">
							<ToggleGroup.Item value="senior_citizen" class="flex-1">Senior</ToggleGroup.Item>
							<ToggleGroup.Item value="pwd" class="flex-1">PWD</ToggleGroup.Item>
						</ToggleGroup.Root>
						{#if claimants.length > 1}
							<Button type="button" variant="ghost" size="icon" class="size-8 text-ink-muted" aria-label="Remove guest {i + 1}" onclick={() => (claimants = claimants.filter((_, j) => j !== i))}>
								<XIcon class="size-4" />
							</Button>
						{/if}
					</div>
					<div class="grid grid-cols-2 gap-2">
						<div class="min-w-0">
							<Label for="claimantName{i}" class="text-xs text-ink-muted">Name</Label>
							<Input id="claimantName{i}" bind:value={c.name} maxlength={160} autocomplete="off" class="mt-1 h-9" />
						</div>
						<div class="min-w-0">
							<Label for="claimantId{i}" class="text-xs text-ink-muted">{c.type === 'pwd' ? 'PWD ID no.' : 'OSCA ID no.'}</Label>
							<Input id="claimantId{i}" bind:value={c.idNumber} maxlength={60} autocomplete="off" class="mt-1 h-9" />
						</div>
					</div>
				</div>
			{/each}

			<button type="button" class="flex w-full items-center gap-1.5 px-3 py-2.5 text-sm text-brand hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand" onclick={() => (claimants = [...claimants, blank()])}>
				<PlusIcon class="size-4" aria-hidden="true" /> Add guest
			</button>
		</div>
	</fieldset>
{/if}
