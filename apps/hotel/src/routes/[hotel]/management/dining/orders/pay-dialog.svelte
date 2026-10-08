<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import PrinterIcon from '@lucide/svelte/icons/printer';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { PageData } from './$types';

	let {
		open = $bindable(false),
		order,
		shiftOpen,
		slug
	}: {
		open: boolean;
		order: PageData['orders'][number] | null;
		shiftOpen: boolean;
		slug: string;
	} = $props();

	const peso = (c: number) =>
		`₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	let method = $state('cash');
	let tendered = $state('');
	let submitting = $state(false);
	let paid = $state<{ changeCentavos: number; receiptId: string | null } | null>(null);

	$effect(() => {
		if (open) {
			method = 'cash';
			tendered = '';
			paid = null;
			submitting = false;
		}
	});

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
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		{#if order}
			{#if paid}
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
					<div class="flex flex-col gap-2 sm:flex-row sm:justify-center">
						{#if paid.receiptId}
							<Button href="/{slug}/print/receipt/{paid.receiptId}" target="_blank" rel="noopener" variant="outline">
								<PrinterIcon class="size-4" /> Print receipt
							</Button>
						{:else}
							<p class="text-xs text-ink-muted">
								No official receipt was issued. Check the BIR series in Finance, then issue it from the order.
							</p>
						{/if}
						<Button onclick={() => (open = false)}>Done</Button>
					</div>
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
					action="?/pay"
					class="space-y-4"
					use:enhance={() => {
						submitting = true;
						return async ({ result, update }) => {
							submitting = false;
							if (result.type === 'success' && result.data?.paid) {
								paid = result.data.paid as { changeCentavos: number; receiptId: string | null };
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
						</ToggleGroup.Root>
						<input type="hidden" name="method" value={method} />
					</div>

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
					{:else}
						<p class="text-sm text-ink-muted">
							Record this after the guest has paid on the terminal or wallet. The full amount is posted to the bank account.
						</p>
					{/if}

					<Dialog.Footer>
						<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
						<Button type="submit" disabled={submitting || cashBlocked}>
							{submitting ? 'Recording…' : `Record ${peso(total)}`}
						</Button>
					</Dialog.Footer>
				</form>
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>
