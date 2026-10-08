<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import UtensilsIcon from '@lucide/svelte/icons/utensils';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import CheckIcon from '@lucide/svelte/icons/check';
	import BanIcon from '@lucide/svelte/icons/ban';
	import type { MenuItemWithAddons } from '$lib/server/dining-menu';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management/dining`);
	const peso = (centavos: number) =>
		`₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const menu = $derived(data.menu);
	const venue = $derived(data.venue);

	// '' = all, 'none' = uncategorised, otherwise a category id.
	let filter = $state('');
	let itemDialog = $state<{ open: boolean; item: MenuItemWithAddons | null }>({ open: false, item: null });
	let categoryDialog = $state<{ open: boolean; id: string | null; name: string }>({
		open: false,
		id: null,
		name: ''
	});
	let newCategory = $state('');

	const visibleItems = $derived(
		(menu?.items ?? []).filter((i) =>
			filter === '' ? true : filter === 'none' ? !i.categoryId : i.categoryId === filter
		)
	);
	const uncategorisedCount = $derived((menu?.items ?? []).filter((i) => !i.categoryId).length);
	const countFor = (id: string) => (menu?.items ?? []).filter((i) => i.categoryId === id).length;
	const categoryName = (id: string | null) =>
		menu?.categories.find((c) => c.id === id)?.name ?? 'Uncategorised';

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			itemDialog.open = false;
			categoryDialog.open = false;
			newCategory = '';
		}
	});

	// Switching venue shouldn't leave a filter pointing at another venue's category.
	$effect(() => {
		void venue?.id;
		filter = '';
	});
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	{#if data.venues.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<UtensilsIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">Add a venue first, then build its menu here.</p>
			<Button href="{base}/settings" variant="outline">Set up venues</Button>
		</div>
	{:else if venue && menu}
		{#if data.venues.length > 1}
			<div class="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Venue">
				{#each data.venues as v (v.id)}
					<a
						href="?venue={v.id}"
						role="tab"
						aria-selected={v.id === venue.id}
						class="rounded-md border px-3 py-1.5 text-sm {v.id === venue.id
							? 'border-brand bg-brand/10 font-medium text-ink'
							: 'border-border text-ink-muted hover:text-ink'}"
					>
						{v.title}{v.isActive ? '' : ' (hidden)'}
					</a>
				{/each}
			</div>
		{/if}

		<div class="grid gap-6 md:grid-cols-[13rem_1fr]">
			<!-- Categories -->
			<aside aria-label="Categories">
				<ul class="space-y-0.5 text-sm">
					<li>
						<button
							type="button"
							onclick={() => (filter = '')}
							aria-current={filter === '' ? 'true' : undefined}
							class="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left {filter === ''
								? 'bg-surface-2 font-medium text-ink'
								: 'text-ink-muted hover:text-ink'}"
						>
							All items <span class="tabular-nums">{menu.items.length}</span>
						</button>
					</li>
					{#each menu.categories as c (c.id)}
						<li class="group flex items-center">
							<button
								type="button"
								onclick={() => (filter = c.id)}
								aria-current={filter === c.id ? 'true' : undefined}
								class="flex min-w-0 flex-1 items-center justify-between rounded-md px-2.5 py-1.5 text-left {filter ===
								c.id
									? 'bg-surface-2 font-medium text-ink'
									: 'text-ink-muted hover:text-ink'}"
							>
								<span class="truncate">{c.name}</span>
								<span class="tabular-nums">{countFor(c.id)}</span>
							</button>
							{#if data.canManageMenu}
								<button
									type="button"
									aria-label="Edit category {c.name}"
									class="ml-0.5 rounded p-1 text-ink-muted hover:text-ink"
									onclick={() => (categoryDialog = { open: true, id: c.id, name: c.name })}
								>
									<PencilIcon class="size-3.5" />
								</button>
							{/if}
						</li>
					{/each}
					{#if uncategorisedCount > 0 && menu.categories.length > 0}
						<li>
							<button
								type="button"
								onclick={() => (filter = 'none')}
								aria-current={filter === 'none' ? 'true' : undefined}
								class="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left {filter ===
								'none'
									? 'bg-surface-2 font-medium text-ink'
									: 'text-ink-muted hover:text-ink'}"
							>
								Uncategorised <span class="tabular-nums">{uncategorisedCount}</span>
							</button>
						</li>
					{/if}
				</ul>

				{#if data.canManageMenu}
				<form method="POST" action="?/createCategory" use:enhance class="mt-4 flex gap-1.5">
					<input type="hidden" name="diningItemId" value={venue.id} />
					<Input
						name="name"
						bind:value={newCategory}
						placeholder="New category"
						aria-label="New category name"
						class="h-8"
						maxlength={80}
					/>
					<Button type="submit" size="icon" variant="outline" class="size-8 shrink-0" aria-label="Add category">
						<PlusIcon class="size-4" />
					</Button>
				</form>
				{/if}
			</aside>

			<!-- Items -->
			<section aria-label="Menu items">
				<div class="mb-3 flex items-center justify-between gap-4">
					<p class="text-sm text-ink-muted">
						{visibleItems.length}
						{visibleItems.length === 1 ? 'item' : 'items'}
						{filter ? `in ${filter === 'none' ? 'Uncategorised' : categoryName(filter)}` : `on ${venue.title}'s menu`}
					</p>
					{#if data.canManageMenu}
						<Button onclick={() => (itemDialog = { open: true, item: null })}>
							<PlusIcon class="size-4" /> New item
						</Button>
					{/if}
				</div>

				{#if visibleItems.length === 0}
					<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
						<UtensilsIcon class="size-6 text-ink-muted" />
						<p class="text-sm text-ink-muted">
							{menu.items.length === 0 ? 'No dishes yet. Add the first one.' : 'Nothing in this category yet.'}
						</p>
					</div>
				{:else}
					<ul class="divide-y divide-border overflow-hidden rounded-xl border border-border">
						{#each visibleItems as item (item.id)}
							<li class="flex items-center gap-3 px-4 py-3 {item.isActive ? '' : 'bg-surface-2/60'}">
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
										<span class="font-medium text-ink {item.isAvailable ? '' : 'line-through decoration-ink-muted'}"
											>{item.name}</span
										>
										{#if item.station}
											<span class="rounded border border-border px-1.5 text-xs text-ink-muted">{item.station}</span>
										{/if}
										{#if !item.isActive}
											<span class="text-xs text-ink-muted">Hidden</span>
										{/if}
										{#if item.addonGroupIds.length > 0}
											<span class="text-xs text-ink-muted">
												{item.addonGroupIds.length} add-on {item.addonGroupIds.length === 1 ? 'group' : 'groups'}
											</span>
										{/if}
									</div>
									{#if item.description}
										<p class="mt-0.5 line-clamp-1 text-sm text-ink-muted">{item.description}</p>
									{/if}
								</div>
								<span class="text-sm font-medium tabular-nums text-ink">{peso(item.priceCentavos)}</span>
								<form method="POST" action="?/toggleAvailable" use:enhance>
									<input type="hidden" name="itemId" value={item.id} />
									<input type="hidden" name="isAvailable" value={item.isAvailable ? 'false' : 'true'} />
									<button
										type="submit"
										title={item.isAvailable ? 'Mark sold out' : 'Mark available again'}
										class="inline-flex w-28 items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium {item.isAvailable
											? 'border-border text-ink hover:bg-surface-2'
											: 'border-danger/40 text-danger hover:bg-danger/10'}"
									>
										{#if item.isAvailable}
											<CheckIcon class="size-3.5" /> Available
										{:else}
											<BanIcon class="size-3.5" /> Sold out
										{/if}
									</button>
								</form>
								{#if data.canManageMenu}
									<Button
										variant="ghost"
										size="icon"
										aria-label="Edit {item.name}"
										onclick={() => (itemDialog = { open: true, item })}
									>
										<PencilIcon class="size-4" />
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	{/if}
</div>

<!-- Item editor -->
<Dialog.Root bind:open={itemDialog.open}>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
		{#if venue && menu}
			{@const item = itemDialog.item}
			<Dialog.Header>
				<Dialog.Title>{item ? `Edit ${item.name}` : 'New menu item'}</Dialog.Title>
				<Dialog.Description>
					Prices are what the guest pays{item ? '' : '; you can add photos and more later'}.
				</Dialog.Description>
			</Dialog.Header>
			<form id="itemForm" method="POST" action="?/saveItem" use:enhance class="space-y-3">
				<input type="hidden" name="diningItemId" value={venue.id} />
				{#if item}<input type="hidden" name="itemId" value={item.id} />{/if}
				<div>
					<Label for="itemName">Name</Label>
					<Input id="itemName" name="name" required value={item?.name ?? ''} placeholder="Chicken adobo" class="mt-1" />
				</div>
				<div>
					<Label for="itemDescription">Description (optional)</Label>
					<textarea
						id="itemDescription"
						name="description"
						rows="2"
						maxlength="500"
						placeholder="Slow-braised in coconut vinegar, garlic rice."
						class="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
						>{item?.description ?? ''}</textarea
					>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="itemPrice">Price (₱)</Label>
						<Input
							id="itemPrice"
							name="pricePhp"
							type="number"
							min="0"
							step="0.01"
							required
							value={item ? (item.priceCentavos / 100).toFixed(2) : ''}
							class="mt-1 tabular-nums"
						/>
					</div>
					<div>
						<Label for="itemCategory">Category</Label>
						<select
							id="itemCategory"
							name="categoryId"
							class="mt-1 h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm"
						>
							<option value="" selected={!item?.categoryId}>Uncategorised</option>
							{#each menu.categories as c (c.id)}
								<option value={c.id} selected={item?.categoryId === c.id}>{c.name}</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="itemStation">Station (optional)</Label>
						<Input
							id="itemStation"
							name="station"
							list="stationOptions"
							value={item?.station ?? ''}
							placeholder="kitchen, bar…"
							class="mt-1"
							autocomplete="off"
						/>
						<datalist id="stationOptions">
							{#each data.stations as s (s)}<option value={s}></option>{/each}
						</datalist>
					</div>
					<div>
						<Label for="itemSort">Sort order</Label>
						<Input id="itemSort" name="sortOrder" type="number" min="0" value={item?.sortOrder ?? 0} class="mt-1" />
					</div>
				</div>

				<fieldset class="space-y-1.5">
					<legend class="text-sm font-medium text-ink">Add-on groups</legend>
					{#if menu.groups.length === 0}
						<p class="text-sm text-ink-muted">
							None yet. <a class="underline" href="{base}/addons?venue={venue.id}">Create add-on groups</a> to offer extras like sauces or sides.
						</p>
					{:else}
						{#each menu.groups as g (g.id)}
							<label class="flex items-center gap-2 text-sm text-ink">
								<input
									type="checkbox"
									name="addonGroupIds"
									value={g.id}
									checked={item?.addonGroupIds.includes(g.id) ?? false}
									class="size-4"
								/>
								{g.name}
								<span class="text-xs text-ink-muted">
									{g.minChoices > 0 ? 'required' : 'optional'}
								</span>
							</label>
						{/each}
					{/if}
				</fieldset>

				<div class="flex flex-col gap-1.5">
					<label class="flex items-center gap-2 text-sm text-ink">
						<input type="checkbox" name="taxable" checked={item?.taxable ?? true} class="size-4" />
						Subject to VAT
					</label>
					<label class="flex items-center gap-2 text-sm text-ink">
						<input type="checkbox" name="isActive" checked={item?.isActive ?? true} class="size-4" />
						Show on the menu
					</label>
				</div>
			</form>
			<Dialog.Footer class="sm:justify-between">
				{#if item}
					<form method="POST" action="?/deleteItem" use:enhance>
						<input type="hidden" name="itemId" value={item.id} />
						<Button type="submit" variant="ghost" class="text-danger hover:text-danger">Remove from menu</Button>
					</form>
				{:else}
					<span></span>
				{/if}
				<div class="flex gap-2">
					<Button variant="outline" onclick={() => (itemDialog.open = false)}>Cancel</Button>
					<Button type="submit" form="itemForm">{item ? 'Save' : 'Add item'}</Button>
				</div>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Category editor -->
<Dialog.Root bind:open={categoryDialog.open}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>Edit category</Dialog.Title>
			<Dialog.Description>Deleting a category keeps its items; they become uncategorised.</Dialog.Description>
		</Dialog.Header>
		<form id="categoryForm" method="POST" action="?/renameCategory" use:enhance class="space-y-3">
			<input type="hidden" name="categoryId" value={categoryDialog.id ?? ''} />
			<div>
				<Label for="categoryName">Name</Label>
				<Input id="categoryName" name="name" required bind:value={categoryDialog.name} maxlength={80} class="mt-1" />
			</div>
		</form>
		<Dialog.Footer class="sm:justify-between">
			<form method="POST" action="?/deleteCategory" use:enhance>
				<input type="hidden" name="categoryId" value={categoryDialog.id ?? ''} />
				<Button type="submit" variant="ghost" class="text-danger hover:text-danger">Delete</Button>
			</form>
			<div class="flex gap-2">
				<Button variant="outline" onclick={() => (categoryDialog.open = false)}>Cancel</Button>
				<Button type="submit" form="categoryForm">Save</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
