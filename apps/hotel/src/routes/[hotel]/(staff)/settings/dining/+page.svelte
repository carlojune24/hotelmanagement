<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { MAX_GALLERY_IMAGES } from '$lib/branding';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);

	let createOpen = $state(false);
	let menuFileInput = $state<HTMLInputElement | undefined>(undefined);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			createOpen = false;
		}
	});
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Dining</h1>
			<p class="text-sm text-ink-muted">
				Restaurants, bars, and cafés shown on your public "Dining" page.
			</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<div class="flex items-center justify-between gap-4">
		<div>
			<h2 class="text-base font-semibold text-ink">Venues</h2>
			<p class="text-sm text-ink-muted">Each gets its own photo, description, and optional hours.</p>
		</div>
		<Button onclick={() => (createOpen = true)}>
			<PlusIcon class="size-4" /> New dining item
		</Button>
	</div>

	<div class="mt-4 overflow-hidden rounded-xl border border-border">
		{#if data.items.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<UtensilsIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">No dining items set up yet.</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head></Table.Head>
						<Table.Head>Title</Table.Head>
						<Table.Head>Hours</Table.Head>
						<Table.Head class="text-right">Edit</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.items as item (item.id)}
						<Table.Row>
							<Table.Cell class="w-14">
								{#if item.photoUrl}
									<img
										src={item.photoUrl}
										alt=""
										class="size-10 rounded-md border border-border object-cover"
									/>
								{:else}
									<div
										class="flex size-10 items-center justify-center rounded-md border border-dashed border-border text-ink-muted"
									>
										<UtensilsIcon class="size-4" />
									</div>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<div class="font-medium text-ink">{item.title}</div>
								{#if !item.isActive}<div class="text-xs text-ink-muted">Inactive</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-ink-muted">{item.operatingHours ?? '—'}</Table.Cell>
							<Table.Cell class="text-right">
								<Button
									variant="ghost"
									size="icon"
									href="{base}/settings/dining/{item.id}"
									aria-label="Edit {item.title}"
								>
									<PencilIcon class="size-4" />
								</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>

	<div class="mt-10 border-t border-border pt-8">
		<Label>Menu photos</Label>
		<p class="mt-1 text-xs text-ink-muted">
			Photos of your menus (menu boards, printed menus) shown on the public "Dining" page below
			your venues. Up to {MAX_GALLERY_IMAGES}.
		</p>

		{#if (data.dining.menuImages ?? []).length > 0}
			<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
				{#each data.dining.menuImages ?? [] as url (url)}
					<div class="group relative">
						<img src={url} alt="" class="aspect-square w-full rounded-md border border-border object-cover" />
						<form method="POST" action="?/removeMenuImage" use:enhance>
							<input type="hidden" name="url" value={url} />
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
			action="?/uploadMenuImages"
			enctype="multipart/form-data"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					if (menuFileInput) menuFileInput.value = '';
				};
			}}
			class="mt-3 flex items-center gap-2"
		>
			<input
				bind:this={menuFileInput}
				name="images"
				type="file"
				multiple
				accept="image/jpeg,image/png,image/webp,image/gif"
				class="text-sm"
			/>
			<Button type="submit" variant="outline" size="sm">Add photos</Button>
		</form>
	</div>
</div>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New dining item</Dialog.Title>
			<Dialog.Description>You can add a photo after creating it.</Dialog.Description>
		</Dialog.Header>
		<form id="createDiningForm" method="POST" action="?/create" use:enhance class="space-y-3">
			<div>
				<Label for="title">Title</Label>
				<Input id="title" name="title" required placeholder="Waling Waling Café" class="mt-1" />
			</div>
			<div>
				<Label for="description">Description</Label>
				<textarea
					id="description"
					name="description"
					rows="3"
					placeholder="All-day dining with Filipino and international favorites."
					class="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
				></textarea>
			</div>
			<div>
				<Label for="operatingHours">Operating hours (optional)</Label>
				<Input
					id="operatingHours"
					name="operatingHours"
					placeholder="6:00 AM – 10:00 PM"
					class="mt-1"
				/>
			</div>
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
			<Button type="submit" form="createDiningForm">Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
