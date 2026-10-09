<script lang="ts">
	import { enhance } from '$app/forms';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { TableCart } from '$lib/dining-cart.svelte';
	import { peso } from '$lib/dining-qr-ui';

	let {
		cart,
		error = null,
		variant = 'panel',
		onsent,
		idPrefix = 'cart'
	}: {
		cart: TableCart;
		/** The server's reason the last attempt failed, shown above the button; the cart is kept. */
		error?: string | null;
		/** `sheet` scrolls its lines and pins the total and Place order button; `panel` is the sticky side column. */
		variant?: 'sheet' | 'panel';
		onsent?: () => void;
		idPrefix?: string;
	} = $props();

	let submitting = $state(false);
	let honeypot = $state('');
	let noteOpen = $state<number | null>(null);

	const payload = $derived(
		JSON.stringify({
			guestName: cart.guestName,
			remarks: cart.note || undefined,
			website: honeypot || undefined,
			lines: cart.lines.map((l) => ({ menuItemId: l.item.id, quantity: l.quantity, remarks: l.remarks || undefined, addonIds: l.addons.map((a) => a.id) }))
		})
	);
</script>

<form
	method="POST"
	action="?/place"
	class="tq-cart tq-cart-{variant}"
	use:enhance={() => {
		submitting = true;
		return async ({ result, update }) => {
			submitting = false;
			if (result.type === 'redirect') {
				cart.clear();
				onsent?.();
			}
			await update({ reset: false });
		};
	}}
>
	<div class="tq-cart-body">
		{#if cart.lines.length === 0}
			<p class="tq-empty">Nothing yet. Tap a dish on the menu to add it.</p>
		{:else}
			<ul class="tq-lines">
				{#each cart.lines as l, i (l.key)}
					<li class="tq-line">
						<span class="tq-line-thumb" aria-hidden="true">
							{#if l.item.imageUrl}
								<img src={l.item.imageUrl} alt="" loading="lazy" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
							{:else}
								<UtensilsIcon class="size-5" />
							{/if}
						</span>
						<div class="tq-line-main">
							<p class="tq-line-name">{l.item.name}</p>
							{#each l.addons as a (a.id)}<p class="tq-line-sub">+ {a.name}</p>{/each}
							{#if l.remarks && noteOpen !== l.key}<p class="tq-line-sub tq-line-note">“{l.remarks}”</p>{/if}
							{#if noteOpen === l.key}
								<Input
									value={l.remarks}
									oninput={(e) => cart.setRemarks(l.key, e.currentTarget.value)}
									maxlength={300}
									placeholder="No onions, extra spicy"
									aria-label="Note for the kitchen about {l.item.name}"
									class="ledger-field tq-note-input"
								/>
							{/if}
							<button type="button" class="tq-link" onclick={() => (noteOpen = noteOpen === l.key ? null : l.key)}>
								{noteOpen === l.key ? 'Done' : l.remarks ? 'Edit note' : 'Add a note'}
							</button>
						</div>
						<div class="tq-line-side">
							<span class="tq-line-price">{peso(cart.totals.priced[i]?.lineTotalCentavos ?? 0)}</span>
							<div class="tq-stepper" role="group" aria-label="Quantity of {l.item.name}">
								<button type="button" aria-label={l.quantity > 1 ? 'Fewer' : `Remove ${l.item.name}`} onclick={() => cart.change(l.key, -1)}>
									{#if l.quantity > 1}<MinusIcon class="size-4" />{:else}<Trash2Icon class="size-4" />{/if}
								</button>
								<span aria-live="polite">{l.quantity}</span>
								<button type="button" aria-label="More" onclick={() => cart.change(l.key, 1)} disabled={l.quantity >= 50}><PlusIcon class="size-4" /></button>
							</div>
						</div>
					</li>
				{/each}
			</ul>

			<div class="tq-fields">
				<div>
					<Label for="{idPrefix}-name" class="ledger-label">Your name</Label>
					<Input id="{idPrefix}-name" bind:value={cart.guestName} required maxlength={60} autocomplete="given-name" class="ledger-field tq-input" />
				</div>
				<div>
					<Label for="{idPrefix}-note" class="ledger-label">Anything we should know (optional)</Label>
					<Textarea id="{idPrefix}-note" bind:value={cart.note} rows={2} maxlength={500} placeholder="Allergies, serve together" class="ledger-field tq-input" />
				</div>
			</div>
		{/if}
	</div>

	{#if cart.lines.length > 0}
		<div class="tq-cart-foot">
			<input type="hidden" name="payload" value={payload} />
			<div class="tq-honeypot" aria-hidden="true">
				<label>Website <input type="text" tabindex="-1" autocomplete="off" bind:value={honeypot} /></label>
			</div>
			<p class="tq-total">
				<span>Total <span class="tq-total-note">VAT included</span></span>
				<span class="tq-total-amount">{peso(cart.totals.totalCentavos)}</span>
			</p>
			{#if error}<p role="alert" class="tq-error-line">{error}</p>{/if}
			<button type="submit" class="ledger-btn-primary tq-btn tq-btn-lg tq-btn-block" disabled={submitting}>
				{submitting ? 'Placing your order…' : `Place order · ${peso(cart.totals.totalCentavos)}`}
			</button>
			<p class="tq-fine">No payment now. A waiter confirms your order first, and you pay at the cash desk.</p>
		</div>
	{/if}
</form>
