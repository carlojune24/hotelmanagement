<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import GemIcon from '@lucide/svelte/icons/gem';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import type { ActionData, PageData } from './$types';
	import type { AmenityItem } from '$lib/server/db/schema/folio';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;

	let createOpen = $state(false);
	let editingItem = $state<AmenityItem | null>(null);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			createOpen = false;
			editingItem = null;
		}
	});
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Sellable items</h1>
			<p class="text-sm text-ink-muted">
				Priced extras front desk can charge to a guest's folio — minibar, laundry, spa, damages,
				anything beyond what's booked. Distinct from "Amenities," which is just descriptive copy
				shown to guests.
			</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<div class="flex items-center justify-between gap-4">
		<div>
			<h2 class="text-base font-semibold text-ink">Catalog</h2>
			<p class="text-sm text-ink-muted">Shown to front desk when adding a charge to a stay.</p>
		</div>
		<Button onclick={() => (createOpen = true)}>
			<PlusIcon class="size-4" /> New item
		</Button>
	</div>

	<div class="mt-4 overflow-hidden rounded-xl border border-border">
		{#if data.items.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<GemIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">No sellable items set up yet.</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>Category</Table.Head>
						<Table.Head class="text-right">Price</Table.Head>
						<Table.Head>Taxable</Table.Head>
						<Table.Head class="text-right">Edit</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.items as item (item.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium text-ink">{item.name}</div>
								{#if !item.isActive}
									<Badge variant="outline" class="mt-1 border-border bg-surface-2 text-ink-muted">
										Inactive
									</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-ink-muted">{item.category || '—'}</Table.Cell>
							<Table.Cell class="text-right text-ink">{peso(item.priceCentavos)}</Table.Cell>
							<Table.Cell class="text-ink-muted">{item.taxable ? 'Yes' : 'No'}</Table.Cell>
							<Table.Cell class="text-right">
								<Button
									variant="ghost"
									size="icon"
									aria-label="Edit {item.name}"
									onclick={() => (editingItem = item)}
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
</div>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New sellable item</Dialog.Title>
			<Dialog.Description>A priced extra front desk can add to a guest's folio.</Dialog.Description>
		</Dialog.Header>
		<form id="createItemForm" method="POST" action="?/create" use:enhance class="space-y-3">
			<div>
				<Label for="name">Name</Label>
				<Input id="name" name="name" required placeholder="Minibar water" class="mt-1" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="category">Category (optional)</Label>
					<Input
						id="category"
						name="category"
						list="categoryOptions"
						placeholder="Food &amp; Beverage"
						class="mt-1"
						autocomplete="off"
					/>
				</div>
				<div>
					<Label for="pricePhp">Price (₱)</Label>
					<Input id="pricePhp" name="pricePhp" type="number" min="0" step="0.01" required class="mt-1" />
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm text-ink">
				<input type="checkbox" name="taxable" checked class="size-4" />
				Subject to VAT
			</label>
			<input type="hidden" name="isActive" value="on" />
			<input type="hidden" name="sortOrder" value="0" />
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
			<Button type="submit" form="createItemForm">Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={editingItem !== null} onOpenChange={(open) => { if (!open) editingItem = null; }}>
	<Dialog.Content>
		{#if editingItem}
			{@const item = editingItem}
			<Dialog.Header>
				<Dialog.Title>Edit {item.name}</Dialog.Title>
			</Dialog.Header>
			<form id="editItemForm" method="POST" action="?/update" use:enhance class="space-y-3">
				<input type="hidden" name="itemId" value={item.id} />
				<div>
					<Label for="editName">Name</Label>
					<Input id="editName" name="name" required value={item.name} class="mt-1" />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="editCategory">Category (optional)</Label>
						<Input
							id="editCategory"
							name="category"
							list="categoryOptions"
							value={item.category ?? ''}
							class="mt-1"
							autocomplete="off"
						/>
					</div>
					<div>
						<Label for="editPricePhp">Price (₱)</Label>
						<Input
							id="editPricePhp"
							name="pricePhp"
							type="number"
							min="0"
							step="0.01"
							required
							value={(item.priceCentavos / 100).toFixed(2)}
							class="mt-1"
						/>
					</div>
				</div>
				<div>
					<Label for="editSortOrder">Sort order</Label>
					<Input
						id="editSortOrder"
						name="sortOrder"
						type="number"
						min="0"
						value={item.sortOrder}
						class="mt-1"
					/>
				</div>
				<label class="flex items-center gap-2 text-sm text-ink">
					<input type="checkbox" name="taxable" checked={item.taxable} class="size-4" />
					Subject to VAT
				</label>
				<label class="flex items-center gap-2 text-sm text-ink">
					<input type="checkbox" name="isActive" checked={item.isActive} class="size-4" />
					Active — offered to front desk
				</label>
			</form>
			<Dialog.Footer class="justify-between">
				<form method="POST" action="?/delete" use:enhance>
					<input type="hidden" name="itemId" value={item.id} />
					<Button variant="destructive" type="submit">Delete</Button>
				</form>
				<div class="flex gap-2">
					<Button variant="outline" onclick={() => (editingItem = null)}>Cancel</Button>
					<Button type="submit" form="editItemForm">Save</Button>
				</div>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<datalist id="categoryOptions">
	{#each data.categories as c (c)}
		<option value={c}></option>
	{/each}
</datalist>
