<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { DiningPhoto } from '$lib/server/db/schema/dining';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management`);
	const item = data.item;
	const photos = $derived((item.photos as DiningPhoto[]) ?? []);

	let photoFileInput = $state<HTMLInputElement | undefined>(undefined);
	let photoTag = $state<'cover' | 'gallery'>('cover');

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">{item.title}</h1>
			<p class="text-sm text-ink-muted">Details shown on your public "Dining" page.</p>
		</div>
		<Button variant="outline" href="{base}/settings/dining">← Dining</Button>
	</div>

	<form method="POST" action="?/update" use:enhance class="space-y-5">
		<div>
			<Label for="title">Title</Label>
			<Input id="title" name="title" required value={item.title} class="mt-1" />
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<Label for="category">Venue type (optional)</Label>
				<Input
					id="category"
					name="category"
					placeholder="Restaurant, Coffee Shop, Bar…"
					value={item.category ?? ''}
					class="mt-1"
				/>
				<p class="mt-1 text-xs text-ink-muted">Shown as a small tag on its card.</p>
			</div>
			<div>
				<Label for="operatingHours">Operating hours (optional)</Label>
				<Input
					id="operatingHours"
					name="operatingHours"
					placeholder="6:00 AM – 10:00 PM"
					value={item.operatingHours ?? ''}
					class="mt-1"
				/>
			</div>
		</div>
		<div>
			<Label for="tagline">Tagline (optional)</Label>
			<Input
				id="tagline"
				name="tagline"
				placeholder="Local & international cuisine, all day."
				value={item.tagline ?? ''}
				class="mt-1"
			/>
			<p class="mt-1 text-xs text-ink-muted">A one-line pitch shown under the title.</p>
		</div>
		<div>
			<Label for="description">Description</Label>
			<textarea
				id="description"
				name="description"
				rows="3"
				class="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
				>{item.description ?? ''}</textarea
			>
		</div>
		<div>
			<Label for="highlights">Highlights (optional)</Label>
			<textarea
				id="highlights"
				name="highlights"
				rows="4"
				placeholder={'Live coffee brewing bar\nAll-day breakfast\nOutdoor seating'}
				class="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
				>{(item.highlights as string[] | null)?.join('\n') ?? ''}</textarea
			>
			<p class="mt-1 text-xs text-ink-muted">
				One per line, up to 6 — shown as a short checklist on the page.
			</p>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<label class="flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="isActive" checked={item.isActive} /> Shown on public page
			</label>
			<div>
				<Label for="sortOrder">Sort order</Label>
				<Input id="sortOrder" name="sortOrder" type="number" min="0" value={item.sortOrder} class="mt-1" />
			</div>
		</div>

		<Button type="submit">Save dining item</Button>
	</form>

	<div class="mt-8 border-t border-border pt-6">
		<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
			<ImageIcon class="size-4 text-brand" /> Photos & Gallery
		</h3>
		<p class="mt-1 text-xs text-ink-muted">
			The cover photo is used on the Dining page's overview card. Add gallery photos for a fuller
			look on its own section further down the page.
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
						<span
							class="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white uppercase"
						>
							{photo.tag}
						</span>
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
			class="mt-3 flex flex-wrap items-center gap-2"
		>
			<input
				bind:this={photoFileInput}
				name="photos"
				type="file"
				multiple
				accept="image/jpeg,image/png,image/webp,image/gif"
				class="text-sm"
			/>
			<Select.Root type="single" name="tag" bind:value={photoTag}>
				<Select.Trigger class="w-32">{photoTag === 'cover' ? 'Cover' : 'Gallery'}</Select.Trigger>
				<Select.Content>
					<Select.Item value="cover" label="Cover" />
					<Select.Item value="gallery" label="Gallery" />
				</Select.Content>
			</Select.Root>
			<Button type="submit" variant="outline" size="sm">Upload photos</Button>
		</form>
	</div>

	<div class="mt-8 border-t border-border pt-6">
		<form
			method="POST"
			action="?/delete"
			use:enhance
			onsubmit={(e) => {
				if (!confirm(`Delete "${item.title}"? This can't be undone.`)) e.preventDefault();
			}}
		>
			<Button type="submit" variant="destructive">
				<Trash2Icon class="size-4" /> Delete dining item
			</Button>
		</form>
	</div>
</div>
