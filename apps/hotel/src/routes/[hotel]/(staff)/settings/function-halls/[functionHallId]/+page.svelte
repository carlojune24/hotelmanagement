<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { RoomPhoto } from '$lib/server/db/schema/inventory';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const h = data.hall;
	const photos = (h.photos as RoomPhoto[]) ?? [];

	let photoFileInput = $state<HTMLInputElement | undefined>(undefined);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">{h.name}</h1>
			<p class="text-sm text-ink-muted">Pricing, capacity, and what's included for your event space.</p>
		</div>
		<Button variant="outline" href="{base}/settings/function-halls">← Function hall</Button>
	</div>

	<form method="POST" action="?/update" use:enhance class="space-y-5">

		<div>
			<Label for="name">Name</Label>
			<Input id="name" name="name" required value={h.name} class="mt-1" />
		</div>
		<div>
			<Label for="description">Description</Label>
			<textarea
				id="description"
				name="description"
				rows="3"
				placeholder="An air-conditioned event space fit for weddings, seminars, and celebrations."
				class="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
				>{h.description ?? ''}</textarea
			>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<Label for="capacity">Capacity (guests)</Label>
				<Input id="capacity" name="capacity" type="number" min="1" required value={h.capacity} class="mt-1" />
			</div>
			<div>
				<Label for="baseHours">Included hours</Label>
				<Input id="baseHours" name="baseHours" type="number" min="1" required value={h.baseHours} class="mt-1" />
			</div>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<Label for="basePricePhp">Base rental (₱)</Label>
				<Input
					id="basePricePhp"
					name="basePricePhp"
					type="number"
					min="0"
					step="0.01"
					required
					value={(h.basePriceCentavos / 100).toFixed(2)}
					class="mt-1"
				/>
				<p class="mt-1 text-xs text-ink-muted">For the included hours above.</p>
			</div>
			<div>
				<Label for="extraHourFeePhp">Extra hour rate (₱)</Label>
				<Input
					id="extraHourFeePhp"
					name="extraHourFeePhp"
					type="number"
					min="0"
					step="0.01"
					required
					value={(h.extraHourFeeCentavos / 100).toFixed(2)}
					class="mt-1"
				/>
				<p class="mt-1 text-xs text-ink-muted">Charged per hour beyond the included block.</p>
			</div>
		</div>

		<div>
			<Label for="includedServicesCsv">Included services (comma-separated)</Label>
			<Input
				id="includedServicesCsv"
				name="includedServicesCsv"
				placeholder="Tables & chairs, Air-conditioned venue, Basic sound system, Projector"
				value={h.includedServices.join(', ')}
				class="mt-1"
			/>
		</div>
		<div>
			<Label for="supportedEventTypesCsv">Event types supported (comma-separated)</Label>
			<Input
				id="supportedEventTypesCsv"
				name="supportedEventTypesCsv"
				placeholder="Wedding, Birthday, Corporate event, Seminar, Anniversary, Reunion, Christening, Meeting"
				value={h.supportedEventTypes.join(', ')}
				class="mt-1"
			/>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<label class="flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="isActive" checked={h.isActive} /> Bookable on the public site
			</label>
			<div>
				<Label for="sortOrder">Sort order</Label>
				<Input id="sortOrder" name="sortOrder" type="number" min="0" value={h.sortOrder} class="mt-1" />
			</div>
		</div>

		<Button type="submit">Save function hall</Button>
	</form>

	<div class="mt-8 border-t border-border pt-6">
		<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
			<ImageIcon class="size-4 text-brand" /> Photos & Gallery
		</h3>
		<p class="mt-1 text-xs text-ink-muted">
			The first photo is used as the cover shot on your booking page.
		</p>

		{#if photos.length > 0}
			<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
				{#each photos as photo (photo.url)}
					<div class="group relative">
						<img
							src={photo.url}
							alt=""
							class="aspect-square w-full rounded-md border border-border object-cover"
						/>
						<form method="POST" action="?/removePhoto" use:enhance>
							<input type="hidden" name="url" value={photo.url} />
							<button
								type="submit"
								aria-label="Remove photo"
								class="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
							>
								✕
							</button>
						</form>
					</div>
				{/each}
			</div>
		{/if}

		<form
			method="POST"
			action="?/uploadPhotos"
			enctype="multipart/form-data"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					if (photoFileInput) photoFileInput.value = '';
				};
			}}
			class="mt-3 flex items-center gap-2"
		>
			<input
				bind:this={photoFileInput}
				name="photos"
				type="file"
				multiple
				accept="image/jpeg,image/png,image/webp,image/gif"
				class="text-sm"
			/>
			<Button type="submit" variant="outline" size="sm">Upload photos</Button>
		</form>
	</div>

	<div class="mt-8 border-t border-border pt-6">
		<form
			method="POST"
			action="?/delete"
			use:enhance
			onsubmit={(e) => {
				if (!confirm(`Delete "${h.name}"? This can't be undone.`)) e.preventDefault();
			}}
		>
			<Button type="submit" variant="destructive" disabled={data.hasBookings}>
				<Trash2Icon class="size-4" /> Delete function hall
			</Button>
			{#if data.hasBookings}
				<p class="mt-1 text-xs text-ink-muted">Has bookings on record — can’t be deleted.</p>
			{/if}
		</form>
	</div>
</div>
