<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let checkIn = $state(data.checkIn ?? '');
	let checkOut = $state(data.checkOut ?? '');
	let adults = $state(data.adults);
	let children = $state(data.children);
	let accessibleOnly = $state(data.accessibleOnly);

	const clampAdults = (n: number) => Math.max(1, Math.min(10, n));
	const clampChildren = (n: number) => Math.max(0, Math.min(10, n));

	const dateError = $derived(checkIn && checkOut && checkIn >= checkOut);
</script>

<svelte:head>
	<title>Check-in & check-out date — Book your stay</title>
</svelte:head>

<div class="max-w-xl">
	<h1 class="ledger-display text-2xl">Check-in &amp; check-out date</h1>
	<p class="mt-1 text-sm text-[var(--ledger-ink-muted)]">
		Pick your dates and party size — we'll show every room that's actually free.
	</p>

	<form method="GET" action="rooms" class="mt-8 space-y-6">
		{#if data.roomTypeId}
			<input type="hidden" name="roomTypeId" value={data.roomTypeId} />
		{/if}

		<div class="grid grid-cols-2 gap-4">
			<div>
				<Label for="checkIn" class="ledger-label">Check-in</Label>
				<Input
					id="checkIn"
					name="checkIn"
					type="date"
					required
					bind:value={checkIn}
					class="ledger-field mt-1"
				/>
			</div>
			<div>
				<Label for="checkOut" class="ledger-label">Check-out</Label>
				<Input
					id="checkOut"
					name="checkOut"
					type="date"
					required
					bind:value={checkOut}
					class="ledger-field mt-1"
				/>
			</div>
		</div>
		{#if dateError}
			<p class="text-sm" style="color: var(--ledger-danger, #b91c1c);">
				Check-out must be after check-in.
			</p>
		{/if}

		<div>
			<div class="ledger-label mb-1">Guests, per room</div>
			<div class="storefront-stepper-row">
				<span class="text-sm text-[var(--ledger-ink)]">Adults</span>
				<div class="storefront-stepper">
					<button
						type="button"
						aria-label="Fewer adults"
						onclick={() => (adults = clampAdults(adults - 1))}><MinusIcon /></button
					>
					<span class="ledger-data">{adults}</span>
					<button
						type="button"
						aria-label="More adults"
						onclick={() => (adults = clampAdults(adults + 1))}><PlusIcon /></button
					>
				</div>
			</div>
			<div class="storefront-stepper-row">
				<span class="text-sm text-[var(--ledger-ink)]">Children</span>
				<div class="storefront-stepper">
					<button
						type="button"
						aria-label="Fewer children"
						onclick={() => (children = clampChildren(children - 1))}><MinusIcon /></button
					>
					<span class="ledger-data">{children}</span>
					<button
						type="button"
						aria-label="More children"
						onclick={() => (children = clampChildren(children + 1))}><PlusIcon /></button
					>
				</div>
			</div>
			<input type="hidden" name="adults" value={adults} />
			<input type="hidden" name="children" value={children} />
		</div>

		<label class="storefront-checkbox-row">
			<input type="checkbox" name="accessible" value="1" bind:checked={accessibleOnly} />
			Wheelchair-accessible rooms only
		</label>

		<Button type="submit" class="ledger-btn-primary" disabled={!!dateError}>Continue</Button>
	</form>
</div>
