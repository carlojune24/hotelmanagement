<script lang="ts">
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
	import DocumentChoice from './document-choice.svelte';
	import DoneDocuments from './done-documents.svelte';
	import type { DocumentChoice as DocChoice, IssuedDocument } from '$lib/print-batch';
	import type { PageData } from './$types';

	let {
		open = $bindable(false),
		order,
		shiftOpen,
		slug,
		inHouse
	}: {
		open: boolean;
		order: PageData['orders'][number] | null;
		shiftOpen: boolean;
		slug: string;
		inHouse: PageData['inHouse'];
	} = $props();

	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	let method = $state('cash');
	let tendered = $state('');
	let submitting = $state(false);
	let paid = $state<{ changeCentavos: number; documents: IssuedDocument[]; documentError: string | null } | null>(null);
	// Which document to issue with the payment (an official receipt unless the cashier says otherwise).
	let docChoice = $state<DocChoice>('or');
	let printAfter = $state(true);
	let printNow = $state(false);
	// Charge to room: pick the in-house guest whose room bill takes this order.
	let guestSearch = $state('');
	let bookingId = $state('');
	let charged = $state<{ roomLabel: string; guestName: string } | null>(null);

	$effect(() => {
		if (open) {
			method = 'cash';
			docChoice = 'or';
			tendered = '';
			paid = null;
			charged = null;
			guestSearch = '';
			bookingId = '';
			submitting = false;
		}
	});

	const matches = $derived.by(() => {
		const q = guestSearch.trim().toLowerCase();
		const list = q
			? inHouse.filter((g) => g.roomNumber.toLowerCase().includes(q) || g.guestName.toLowerCase().includes(q) || g.bookingCode.toLowerCase().includes(q))
			: inHouse;
		return list.slice(0, 40);
	});
	const chosen = $derived(inHouse.find((g) => g.bookingId === bookingId) ?? null);

	const total = $derived(order?.totalCentavos ?? 0);
	const tenderedCentavos = $derived(Math.round((Number(tendered) || 0) * 100));
	const change = $derived(Math.max(0, tenderedCentavos - total));
	const shortBy = $derived(Math.max(0, total - tenderedCentavos));
	// A few sensible notes to tap: the exact amount, then the next round figures above it.
	const quick = $derived.by(() => {
		const out = new Set<number>([total]);
		for (const step of [10_000, 50_000, 100_000, 200_000]) {
			const v = Math.ceil(total / step) * step;
			if (v >= total) out.add(v);
		}
		return [...out].sort((a, b) => a - b).slice(0, 4);
	});
	const cashBlocked = $derived(method === 'cash' && (!shiftOpen || tenderedCentavos < total));
	const roomBlocked = $derived(method === 'room' && !chosen);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92dvh] overflow-y-auto sm:max-w-md">
		{#if order}
			{#if charged}
				<div class="space-y-4 py-2 text-center">
					<CircleCheckIcon class="mx-auto size-10 text-brand" aria-hidden="true" />
					<div>
						<Dialog.Title class="text-lg">Charged to room {charged.roomLabel}</Dialog.Title>
						<p class="mt-1 text-sm text-ink-muted">{order.code} · {peso(order.totalCentavos)} · {charged.guestName}</p>
					</div>
					<p class="text-sm text-ink-muted">It is on the guest's room bill and will be paid with the rest of it at check-out.</p>
					<Button onclick={() => (open = false)}>Done</Button>
				</div>
			{:else if paid}
				<div class="space-y-4 py-2 text-center">
					<CircleCheckIcon class="mx-auto size-10 text-brand" aria-hidden="true" />
					<div>
						<Dialog.Title class="text-lg">Paid</Dialog.Title>
						<p class="mt-1 text-sm text-ink-muted">{order.code} · {peso(order.totalCentavos)}</p>
					</div>
					{#if paid.changeCentavos > 0}
						<div class="rounded-lg bg-surface-2 px-4 py-3">
							<p class="text-xs text-ink-muted">Change due</p>
							<p class="text-2xl font-semibold tabular-nums text-ink">{peso(paid.changeCentavos)}</p>
						</div>
					{/if}
					<DoneDocuments
						documents={paid.documents}
						documentError={paid.documentError}
						{slug}
						billHref="/{slug}/print/bill/order/{order.id}?auto=1"
						auto={printNow}
					/>
					<Button variant={paid.documents.length > 0 ? 'outline' : 'default'} class="h-11 w-full" onclick={() => (open = false)}>Done</Button>
				</div>
			{:else}
				<Dialog.Header>
					<Dialog.Title>Take payment</Dialog.Title>
					<Dialog.Description>
						{order.code}{order.tableLabel ? ` · table ${order.tableLabel}` : ''}{order.guestName ? ` · ${order.guestName}` : ''}
					</Dialog.Description>
				</Dialog.Header>

				<div class="rounded-lg bg-surface-2 px-4 py-3 text-center">
					<p class="text-xs text-ink-muted">Amount due, VAT included</p>
					<p class="text-3xl font-semibold tabular-nums text-ink">{peso(total)}</p>
				</div>

				<form
					method="POST"
					action={method === 'room' ? '?/chargeRoom' : '?/pay'}
					class="space-y-4"
					use:enhance={() => {
						submitting = true;
						return async ({ result, update }) => {
							submitting = false;
							if (result.type === 'success' && result.data?.charged) {
								charged = result.data.charged as { roomLabel: string; guestName: string };
								await invalidateAll();
							} else if (result.type === 'success' && result.data?.paid) {
								printNow = printAfter;
							paid = result.data.paid as { changeCentavos: number; documents: IssuedDocument[]; documentError: string | null };
								await invalidateAll();
							} else {
								await update({ reset: false });
							}
						};
					}}
				>
					<input type="hidden" name="orderId" value={order.id} />
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
							<Label for="guestSearch" class="text-xs">Charge to which guest?</Label>
							<div class="relative mt-1">
								<SearchIcon class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
								<Input id="guestSearch" bind:value={guestSearch} placeholder="Room number or guest name" autocomplete="off" class="pl-8" />
							</div>
							<ul class="mt-2 max-h-52 divide-y divide-border overflow-y-auto rounded-lg border border-border" role="radiogroup" aria-label="Guests staying now">
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
						</div>
						<p class="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-muted">
							<BedDoubleIcon class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
							{#if chosen}
								{peso(total)} goes on {chosen.guestName}'s bill for room {chosen.roomNumber}. They pay it at check-out.
							{:else}
								Nothing is paid now. The total is added to the guest's room bill.
							{/if}
						</p>
					{/if}

					{#if method === 'cash'}
						{#if !shiftOpen}
							<div class="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2.5 text-sm text-ink" role="alert">
								<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
								<p>
									No cashier shift is open, so cash can't be taken yet.
									<a class="underline" href="/{slug}/management/finance">Open a shift in Finance</a>, or choose another payment method.
								</p>
							</div>
						{/if}
						<div>
							<Label for="tendered" class="text-xs">Cash received (₱)</Label>
							<Input id="tendered" name="tenderedPhp" type="number" inputmode="decimal" min="0" step="0.01" bind:value={tendered} class="mt-1 text-lg tabular-nums" />
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
					{:else if method !== 'room'}
						<p class="text-sm text-ink-muted">
							Record this after the guest has paid on the terminal or wallet. The full amount is posted to the bank account.
						</p>
					{/if}

					{#if method !== 'room'}
						<DocumentChoice bind:value={docChoice} bind:printAfter guestName={order.guestName ?? ''} />
					{/if}

					<Dialog.Footer>
						<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
						<Button type="submit" disabled={submitting || cashBlocked || roomBlocked}>
							{submitting ? 'Recording…' : method === 'room' ? (chosen ? `Charge to room ${chosen.roomNumber}` : 'Choose a guest') : `Record ${peso(total)}`}
						</Button>
					</Dialog.Footer>
				</form>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
