<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import SearchIcon from '@lucide/svelte/icons/search';
	import BedDoubleIcon from '@lucide/svelte/icons/bed-double';
	import type { PageData } from './$types';

	type Check = PageData['checks'][number];

	let {
		open = $bindable(false),
		check,
		shiftOpen,
		slug,
		inHouse
	}: {
		open: boolean;
		check: Check | null;
		shiftOpen: boolean;
		slug: string;
		inHouse: PageData['inHouse'];
	} = $props();

	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	let method = $state('cash');
	let tendered = $state('');
	let submitting = $state(false);
	let guestSearch = $state('');
	let bookingId = $state('');
	let done = $state<{ change: number; closed: boolean } | null>(null);

	// Only `open` is tracked: the floor plan refreshes `check` every few seconds, and that must
	// not wipe the amount the cashier is typing.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			method = 'cash';
			tendered = '';
			guestSearch = '';
			bookingId = '';
			submitting = false;
			done = null;
		});
	});

	const unpaid = $derived(check?.orders.filter((o) => o.status !== 'cancelled' && o.status !== 'pending_acceptance' && o.paymentStatus === 'unpaid') ?? []);
	const total = $derived(check?.unpaidCentavos ?? 0);
	const tenderedCentavos = $derived(Math.round((Number(tendered) || 0) * 100));
	const change = $derived(Math.max(0, tenderedCentavos - total));
	const shortBy = $derived(Math.max(0, total - tenderedCentavos));
	const quick = $derived.by(() => {
		const out = new Set<number>([total]);
		for (const step of [10_000, 50_000, 100_000, 200_000]) {
			const v = Math.ceil(total / step) * step;
			if (v >= total) out.add(v);
		}
		return [...out].sort((a, b) => a - b).slice(0, 4);
	});

	const matches = $derived.by(() => {
		const q = guestSearch.trim().toLowerCase();
		const list = q
			? inHouse.filter((g) => g.roomNumber.toLowerCase().includes(q) || g.guestName.toLowerCase().includes(q) || g.bookingCode.toLowerCase().includes(q))
			: inHouse;
		return list.slice(0, 40);
	});
	const chosen = $derived(inHouse.find((g) => g.bookingId === bookingId) ?? null);
	const blocked = $derived(
		(method === 'cash' && (!shiftOpen || tenderedCentavos < total)) || (method === 'room' && !chosen) || unpaid.length === 0
	);
	// Settling frees the table only if everything has also been served.
	const willClose = $derived(!!check && check.inProgress === 0 && check.awaitingAcceptance === 0);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92dvh] overflow-y-auto sm:max-w-md">
		{#if check}
			{#if done}
				<div class="space-y-4 py-2 text-center">
					<CircleCheckIcon class="mx-auto size-10 text-brand" aria-hidden="true" />
					<div>
						<Dialog.Title class="text-lg">Table {check.tableName} paid</Dialog.Title>
						<p class="mt-1 text-sm text-ink-muted">
							{done.closed ? 'The table is free again.' : 'It stays open until everything is served.'}
						</p>
					</div>
					{#if done.change > 0}
						<div class="rounded-lg bg-surface-2 px-4 py-3">
							<p class="text-xs text-ink-muted">Change due</p>
							<p class="text-2xl font-semibold tabular-nums text-ink">{peso(done.change)}</p>
						</div>
					{/if}
					<p class="text-xs text-ink-muted">Each order has its own receipt on the Orders board.</p>
					<Button onclick={() => (open = false)}>Done</Button>
				</div>
			{:else}
				<Dialog.Header>
					<Dialog.Title>Settle table {check.tableName}</Dialog.Title>
					<Dialog.Description>
						{unpaid.length} unpaid {unpaid.length === 1 ? 'order' : 'orders'}. They are paid together with one method.
					</Dialog.Description>
				</Dialog.Header>

				<ul class="divide-y divide-border rounded-lg border border-border text-sm" aria-label="Orders to pay">
					{#each unpaid as o (o.id)}
						<li class="flex items-center justify-between gap-3 px-3 py-2">
							<span class="font-mono text-ink">{o.code}</span>
							<span class="tabular-nums text-ink">{peso(o.totalCentavos)}</span>
						</li>
					{:else}
						<li class="px-3 py-4 text-center text-ink-muted">Nothing left to pay.</li>
					{/each}
				</ul>

				<div class="rounded-lg bg-surface-2 px-4 py-3 text-center">
					<p class="text-xs text-ink-muted">Amount due, VAT included</p>
					<p class="text-3xl font-semibold tabular-nums text-ink">{peso(total)}</p>
				</div>

				<form
					method="POST"
					action="?/settle"
					class="space-y-4"
					use:enhance={() => {
						submitting = true;
						return async ({ result, update }) => {
							submitting = false;
							if (result.type === 'success' && result.data?.settled) {
								done = result.data.settled as { change: number; closed: boolean };
								await invalidateAll();
							} else {
								await update({ reset: false });
							}
						};
					}}
				>
					<input type="hidden" name="checkId" value={check.id} />
					<div>
						<Label class="text-xs">Paid by</Label>
						<ToggleGroup.Root type="single" bind:value={method} variant="outline" class="mt-1 w-full">
							<ToggleGroup.Item value="cash" class="flex-1">Cash</ToggleGroup.Item>
							<ToggleGroup.Item value="card" class="flex-1">Card</ToggleGroup.Item>
							<ToggleGroup.Item value="gcash" class="flex-1">GCash</ToggleGroup.Item>
							<ToggleGroup.Item value="maya" class="flex-1">Maya</ToggleGroup.Item>
							<ToggleGroup.Item value="room" class="flex-1">Room</ToggleGroup.Item>
						</ToggleGroup.Root>
						<input type="hidden" name="method" value={method} />
						<input type="hidden" name="bookingId" value={bookingId} />
					</div>

					{#if method === 'room'}
						<div>
							<Label for="settleGuest" class="text-xs">Charge to which guest?</Label>
							<div class="relative mt-1">
								<SearchIcon class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
								<Input id="settleGuest" bind:value={guestSearch} placeholder="Room number or guest name" autocomplete="off" class="pl-8" />
							</div>
							<ul class="mt-2 max-h-44 divide-y divide-border overflow-y-auto rounded-lg border border-border" role="radiogroup" aria-label="Guests staying now">
								{#each matches as g (g.bookingId)}
									<li>
										<button
											type="button"
											role="radio"
											aria-checked={bookingId === g.bookingId}
											class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2 {bookingId === g.bookingId ? 'bg-brand/10' : ''}"
											onclick={() => (bookingId = g.bookingId)}
										>
											<span class="w-14 shrink-0 font-mono font-semibold text-ink">{g.roomNumber}</span>
											<span class="min-w-0 flex-1 truncate text-ink">{g.guestName}</span>
											<span class="font-mono text-xs text-ink-muted">{g.bookingCode}</span>
										</button>
									</li>
								{:else}
									<li class="px-3 py-6 text-center text-sm text-ink-muted">
										{inHouse.length === 0 ? 'No guests are checked in right now.' : `No guest matches "${guestSearch}".`}
									</li>
								{/each}
							</ul>
							<p class="mt-2 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
								<BedDoubleIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
								{#if chosen}
									{peso(total)} goes on {chosen.guestName}'s bill for room {chosen.roomNumber}.
								{:else}
									Nothing is paid now. The whole table is added to the guest's room bill.
								{/if}
							</p>
						</div>
					{:else if method === 'cash'}
						{#if !shiftOpen}
							<div class="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2.5 text-sm text-ink" role="alert">
								<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
								<p>
									No cashier shift is open, so cash can't be taken yet.
									<a class="underline" href="/{slug}/management/finance">Open a shift in Finance</a>, or choose another method.
								</p>
							</div>
						{/if}
						<div>
							<Label for="settleTendered" class="text-xs">Cash received (₱)</Label>
							<Input id="settleTendered" name="tendered" type="number" inputmode="decimal" min="0" step="0.01" bind:value={tendered} class="mt-1 text-lg tabular-nums" />
							<div class="mt-2 flex flex-wrap gap-1.5">
								{#each quick as q (q)}
									<Button type="button" variant="outline" size="sm" class="tabular-nums" onclick={() => (tendered = (q / 100).toFixed(2))}>
										{q === total ? 'Exact' : peso(q).replace('.00', '')}
									</Button>
								{/each}
							</div>
						</div>
						<div class="flex items-baseline justify-between rounded-lg border border-border px-4 py-2.5" aria-live="polite">
							{#if tendered && shortBy > 0}
								<span class="text-sm text-danger">Short by</span>
								<span class="text-lg font-semibold tabular-nums text-danger">{peso(shortBy)}</span>
							{:else}
								<span class="text-sm text-ink-muted">Change</span>
								<span class="text-lg font-semibold tabular-nums text-ink">{peso(change)}</span>
							{/if}
						</div>
					{:else}
						<p class="text-sm text-ink-muted">Record this after the guest has paid on the terminal or wallet.</p>
					{/if}

					<p class="text-xs text-ink-muted">
						{willClose
							? 'Everything is served, so the table is freed once this is paid.'
							: 'Some orders are still being made or served; the table stays open until they are.'}
					</p>

					<Dialog.Footer>
						<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
						<Button type="submit" disabled={submitting || blocked}>
							{submitting ? 'Recording…' : method === 'room' ? (chosen ? `Charge to room ${chosen.roomNumber}` : 'Choose a guest') : `Record ${peso(total)}`}
						</Button>
					</Dialog.Footer>
				</form>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
