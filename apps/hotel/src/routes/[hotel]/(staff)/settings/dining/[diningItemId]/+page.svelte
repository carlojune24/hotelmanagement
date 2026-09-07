<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ImageIcon from '@lucide/svelte/icons/image';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const item = data.item;

	let photoFileInput = $state<HTMLInputElement | undefined>(undefined);

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
			<Label for="operatingHours">Operating hours (optional)</Label>
			<Input
				id="operatingHours"
				name="operatingHours"
				placeholder="6:00 AM – 10:00 PM"
				value={item.operatingHours ?? ''}
				class="mt-1"
			/>
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
			<ImageIcon class="size-4 text-brand" /> Photo
		</h3>

		{#if item.photoUrl}
			<div class="mt-3 flex items-center gap-3">
				<img
					src={item.photoUrl}
					alt=""
					class="h-20 w-28 rounded-md border border-border object-cover"
				/>
				<form method="POST" action="?/removePhoto" use:enhance>
					<Button type="submit" variant="ghost" size="sm" class="text-ink-muted hover:text-danger">
						Remove
					</Button>
				</form>
			</div>
		{/if}

		<form
			method="POST"
			action="?/uploadPhoto"
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
				name="photo"
				type="file"
				accept="image/jpeg,image/png,image/webp,image/gif"
				class="text-sm"
			/>
			<Button type="submit" variant="outline" size="sm">
				{item.photoUrl ? 'Replace photo' : 'Upload photo'}
			</Button>
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
