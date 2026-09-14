<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const peso = (c: number) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

	interface CartLine {
		amenityItemId: string | null;
		description: string;
		quantity: number;
		unitPriceCentavos: number;
	}

	let cart = $state<CartLine[]>([]);
	let method = $state<(typeof data.methods)[number]>('cash');
	let customName = $state('');
	let customPrice = $state('');

	const total = $derived(cart.reduce((s, l) => s + l.unitPriceCentavos * l.quantity, 0));

	function addItem(item: PageData['items'][number]) {
		const existing = cart.find((l) => l.amenityItemId === item.id);
		if (existing) existing.quantity++;
		else cart.push({ amenityItemId: item.id, description: item.name, quantity: 1, unitPriceCentavos: item.priceCentavos });
	}

	function addCustom() {
		const priceCentavos = Math.round(parseFloat(customPrice) * 100);
		if (!customName.trim() || !Number.isFinite(priceCentavos) || priceCentavos <= 0) {
			toast.error('Enter a name and a positive price.');
			return;
		}
		cart.push({ amenityItemId: null, description: customName.trim(), quantity: 1, unitPriceCentavos: priceCentavos });
		customName = '';
		customPrice = '';
	}

	function removeLine(i: number) {
		cart.splice(i, 1);
	}

	let cartJson = $derived(JSON.stringify({ method, lines: cart }));

	$effect(() => {
		if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			cart = [];
		}
		if (form && 'error' in form && form.error) toast.error(form.error);
	});
</script>

<div class="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">Quick sale</h1>
	<p class="mb-5 text-sm text-ink-muted">
		Sell something to a walk-in with no room or hall booking — posts straight to cash-in, no
		guest record needed.
	</p>

	{#if data.requireOpenShiftForCashPayment && !data.hasOpenShift}
		<div class="mb-5 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
			No cashier shift is open. Cash sales need an open drawer shift — open one on
			<a href="../shifts" class="underline">Shifts</a> first, or choose a non-cash method below.
		</div>
	{/if}

	<div class="grid gap-6 md:grid-cols-[1fr_320px]">
		<section class="rounded-xl border border-border bg-surface-2 p-5">
			<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">Catalog</h2>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each data.items as item (item.id)}
					<button
						type="button"
						onclick={() => addItem(item)}
						class="flex items-center justify-between rounded-lg border border-border p-3 text-left text-sm hover:border-brand/50"
					>
						<span>
							<span class="text-ink">{item.name}</span>
							{#if item.category}<span class="ml-1 text-xs text-ink-muted">· {item.category}</span>{/if}
						</span>
						<span class="font-medium text-ink">{peso(item.priceCentavos)}</span>
					</button>
				{/each}
				{#if data.items.length === 0}
					<p class="text-sm text-ink-muted">
						No sellable items yet — add some under Settings → Sellable items.
					</p>
				{/if}
			</div>

			<h3 class="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-ink-muted">Custom item</h3>
			<div class="flex gap-2">
				<Input placeholder="Name" bind:value={customName} class="flex-1" />
				<Input placeholder="Price" type="number" step="0.01" min="0" bind:value={customPrice} class="w-28" />
				<Button type="button" variant="outline" onclick={addCustom}>Add</Button>
			</div>
		</section>

		<section class="h-fit rounded-xl border border-border bg-surface-2 p-5">
			<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">Cart</h2>
			{#if cart.length === 0}
				<p class="text-sm text-ink-muted">Tap an item to add it.</p>
			{:else}
				<div class="space-y-2">
					{#each cart as line, i (i)}
						<div class="flex items-center justify-between gap-2 text-sm">
							<div class="min-w-0 flex-1">
								<p class="truncate text-ink">{line.description}</p>
								<p class="text-xs text-ink-muted">{peso(line.unitPriceCentavos)} each</p>
							</div>
							<input
								type="number"
								min="1"
								bind:value={line.quantity}
								class="w-14 rounded-md border border-input bg-transparent px-2 py-1 text-center text-sm"
							/>
							<button type="button" onclick={() => removeLine(i)} class="text-xs text-ink-muted hover:text-danger">✕</button>
						</div>
					{/each}
				</div>
			{/if}

			<div class="mt-4 flex items-center justify-between border-t border-border pt-3">
				<span class="text-sm font-medium text-ink">Total</span>
				<span class="text-lg font-semibold text-ink">{peso(total)}</span>
			</div>

			<div class="mt-3">
				<label class="text-xs text-ink-muted" for="method">Payment method</label>
				<select id="method" bind:value={method} class="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm">
					{#each data.methods as m (m)}
						<option value={m}>{m.replace(/_/g, ' ')}</option>
					{/each}
				</select>
			</div>

			<form
				method="POST"
				action="?/sell"
				use:enhance={() => {
					return async ({ update }) => {
						await update();
					};
				}}
				class="mt-3"
			>
				<input type="hidden" name="cart" value={cartJson} />
				<Button type="submit" class="w-full" disabled={cart.length === 0}>Charge {peso(total)}</Button>
			</form>
		</section>
	</div>

	{#if data.recentSales.length > 0}
		<section class="mt-6 rounded-xl border border-border bg-surface-2 p-5">
			<h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">Recent quick sales</h2>
			<div class="divide-y divide-border">
				{#each data.recentSales as s (s.id)}
					<div class="flex items-center justify-between py-2 text-sm">
						<div class="min-w-0">
							<span class="text-ink">{s.items.map((i) => `${i.quantity}x ${i.description}`).join(', ')}</span>
							<span class="ml-2 text-xs text-ink-muted">{s.method.replace(/_/g, ' ')}</span>
						</div>
						<span class="font-medium text-ink">{peso(s.totalCentavos)}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
