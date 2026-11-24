<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import XIcon from '@lucide/svelte/icons/x';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import {
		computeScPwdShare,
		type ScPwdChargeOption,
		type ScPwdShareResult
	} from '$lib/sc-pwd-discount';

	/**
	 * Senior Citizen / PWD discount fields for a room: each qualifying guest (name + OSCA/PWD ID), how
	 * many stay in the room, and which charges it covers. Room nights are split per head; any other
	 * ticked charge counts in full. Same layout as dining's `discount-fields.svelte`. Posts
	 * `scPwdClaimants` (JSON), `scPwdGuests` and `scPwdCharge` (one per tick), read by `parseScPwdForm`
	 * in `lib/server/sc-pwd-discount.ts`, which re-prices everything from the booking.
	 */
	let {
		options,
		defaultGuests,
		discountBps,
		promoCentavos = 0,
		defaultName = '',
		firstNameOptional = false,
		preview = $bindable(null),
		ready = $bindable(true)
	}: {
		options: ScPwdChargeOption[];
		defaultGuests: number;
		discountBps: number;
		/** The booking's promo discount: SC/PWD replaces it, never stacks. */
		promoCentavos?: number;
		/** Pre-fills the first guest's name (usually the booking guest). */
		defaultName?: string;
		/** The first guest's name may be left blank (the server uses the booking guest's). */
		firstNameOptional?: boolean;
		/** Out: the worked discount, or null while incomplete. */
		preview?: ScPwdShareResult | null;
		/** Out: false while a name, ID, the guest count or a ticked charge is missing. */
		ready?: boolean;
	} = $props();

	type Claimant = { type: 'senior_citizen' | 'pwd'; name: string; idNumber: string };
	// svelte-ignore state_referenced_locally
	let claimants = $state<Claimant[]>([{ type: 'senior_citizen', name: defaultName, idNumber: '' }]);
	// svelte-ignore state_referenced_locally
	let guests = $state(String(defaultGuests));
	// svelte-ignore state_referenced_locally
	let ticked = $state<string[]>(options.filter((o) => o.defaultOn).map((o) => o.key));

	const guestsN = $derived(Math.floor(Number(guests)) || 0);
	const pct = $derived(`${discountBps / 100}%`);
	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const picked = $derived(options.filter((o) => ticked.includes(o.key)));
	const calc = $derived(
		guestsN >= claimants.length && picked.length > 0
			? computeScPwdShare({ lines: picked, claimants: claimants.length, guests: guestsN, discountBps })
			: null
	);
	const promoWins = $derived(promoCentavos > 0 && calc != null && calc.totalReductionCentavos <= promoCentavos);

	$effect(() => {
		preview = calc;
		ready =
			calc != null && !promoWins && claimants.every((c, i) => (c.name.trim() || (firstNameOptional && i === 0)) && c.idNumber.trim());
	});
</script>

<fieldset class="space-y-1.5">
	<legend class="text-xs font-medium text-ink">Senior / PWD guests</legend>
	<input type="hidden" name="scPwdClaimants" value={JSON.stringify(claimants)} />
	<input type="hidden" name="scPwdChargesSent" value="1" />
	<div class="divide-y divide-border overflow-hidden rounded-lg border border-border">
		<!-- How many stay decides the share of the room the discount covers, so it comes first. -->
		<div class="bg-surface-2/50 px-3 py-2.5">
			<div class="flex items-center justify-between gap-3">
				<Label for="scPwdGuests" class="text-sm">Guests in the room</Label>
				<Input
					id="scPwdGuests"
					name="scPwdGuests"
					type="number"
					inputmode="numeric"
					min={claimants.length}
					step="1"
					bind:value={guests}
					class="h-8 w-20 text-right tabular-nums"
				/>
			</div>
			<p class="mt-1 text-xs text-ink-muted" aria-live="polite">
				{#if guestsN >= claimants.length}
					{claimants.length} of {guestsN} share of the room is VAT-exempt and gets {pct} off.
				{:else}
					Enter how many stay in the room, at least {claimants.length}.
				{/if}
			</p>
		</div>

		{#each claimants as c, i (i)}
			<div class="space-y-2 px-3 py-2.5">
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium text-ink">Guest {i + 1}</span>
					<ToggleGroup.Root
						type="single"
						value={c.type}
						onValueChange={(v) => v && (c.type = v as Claimant['type'])}
						variant="outline"
						size="sm"
						class="ml-auto w-36"
						aria-label="Guest {i + 1} is a"
					>
						<ToggleGroup.Item value="senior_citizen" class="flex-1">Senior</ToggleGroup.Item>
						<ToggleGroup.Item value="pwd" class="flex-1">PWD</ToggleGroup.Item>
					</ToggleGroup.Root>
					{#if claimants.length > 1}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="size-8 text-ink-muted"
							aria-label="Remove guest {i + 1}"
							onclick={() => (claimants = claimants.filter((_, j) => j !== i))}
						>
							<XIcon class="size-4" />
						</Button>
					{/if}
				</div>
				<div class="grid grid-cols-2 gap-2">
					<div class="min-w-0">
						<Label for="scPwdName{i}" class="text-xs text-ink-muted">Name</Label>
						<Input
							id="scPwdName{i}"
							bind:value={c.name}
							maxlength={160}
							autocomplete="off"
							placeholder={firstNameOptional && i === 0 ? "Blank = the guest's name" : undefined}
							class="mt-1 h-9"
						/>
					</div>
					<div class="min-w-0">
						<Label for="scPwdId{i}" class="text-xs text-ink-muted">
							{c.type === 'pwd' ? 'PWD ID no.' : 'OSCA ID no.'}
						</Label>
						<Input id="scPwdId{i}" bind:value={c.idNumber} maxlength={60} autocomplete="off" class="mt-1 h-9" />
					</div>
				</div>
			</div>
		{/each}

		<button
			type="button"
			class="flex w-full items-center gap-1.5 px-3 py-2.5 text-sm text-brand hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
			onclick={() => (claimants = [...claimants, { type: 'senior_citizen', name: '', idNumber: '' }])}
		>
			<PlusIcon class="size-4" aria-hidden="true" /> Add guest
		</button>

		<div class="space-y-1.5 px-3 py-2.5">
			<p class="text-xs font-medium text-ink">Covers</p>
			{#each options as o (o.key)}
				<label class="flex items-start gap-2 text-sm">
					<input type="checkbox" name="scPwdCharge" value={o.key} bind:group={ticked} class="mt-0.5 size-4" />
					<span class="min-w-0 flex-1">
						{o.label}
						<span class="block text-xs text-ink-muted">
							{o.perHead ? 'Split per head' : 'Their own, in full'}
						</span>
					</span>
					<span class="tabular-nums text-ink-muted">{peso(o.amountCentavos)}</span>
				</label>
			{/each}
			{#if ticked.length === 0}
				<p class="text-xs text-destructive">Tick at least one charge.</p>
			{/if}
		</div>

		{#if calc}
			<dl class="space-y-0.5 px-3 py-2.5 text-sm">
				<div class="flex justify-between gap-3">
					<dt class="text-ink-muted">Senior / PWD share</dt>
					<dd class="tabular-nums">{peso(calc.shareCentavos)}</dd>
				</div>
				{#if calc.vatRemovedCentavos > 0}
					<div class="flex justify-between gap-3">
						<dt class="text-ink-muted">VAT removed (exempt sale)</dt>
						<dd class="tabular-nums">−{peso(calc.vatRemovedCentavos)}</dd>
					</div>
				{/if}
				<div class="flex justify-between gap-3">
					<dt class="text-ink-muted">{pct} discount on {peso(calc.baseAmountCentavos)}</dt>
					<dd class="tabular-nums">−{peso(calc.discountCentavos)}</dd>
				</div>
				{#if promoCentavos > 0}
					<div class="flex justify-between gap-3">
						<dt class="text-ink-muted">Promo given back (can't combine)</dt>
						<dd class="tabular-nums">+{peso(promoCentavos)}</dd>
					</div>
				{/if}
				<div class="flex justify-between gap-3 font-medium text-ink">
					<dt>Bill goes down by</dt>
					<dd class="tabular-nums">{peso(calc.totalReductionCentavos - promoCentavos)}</dd>
				</div>
			</dl>
			{#if promoWins}
				<p class="px-3 pb-2.5 text-xs text-destructive" role="alert">
					The promo ({peso(promoCentavos)} off) is already the lower price. Senior/PWD and a promo can't
					be combined, so keep the promo.
				</p>
			{/if}
		{/if}
	</div>
</fieldset>
