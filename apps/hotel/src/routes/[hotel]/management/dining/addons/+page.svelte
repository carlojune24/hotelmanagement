<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import type { AddonGroupWithAddons } from '$lib/server/dining-menu';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management/dining`);
	const peso = (centavos: number) =>
		centavos === 0
			? 'Free'
			: `+₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	let groupDialog = $state<{ open: boolean; group: AddonGroupWithAddons | null }>({
		open: false,
		group: null
	});
	let addonDialog = $state<{
		open: boolean;
		addon: { id: string; name: string; priceCentavos: number; isAvailable: boolean } | null;
	}>({ open: false, addon: null });

	const rule = (g: AddonGroupWithAddons) => {
		if (g.minChoices > 0 && g.maxChoices === g.minChoices) return `Pick exactly ${g.minChoices}`;
		if (g.minChoices > 0) return g.maxChoices ? `Pick ${g.minChoices}–${g.maxChoices}` : `Pick at least ${g.minChoices}`;
		return g.maxChoices ? `Optional, up to ${g.maxChoices}` : 'Optional';
	};

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			groupDialog.open = false;
			addonDialog.open = false;
		}
	});
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
	{#if data.venues.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
			<LayersIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">Add a venue first, then set up its add-ons.</p>
			<Button href="{base}/settings" variant="outline">Set up venues</Button>
		</div>
	{:else if data.venue}
		{@const venue = data.venue}
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
						{v.title}
					</a>
				{/each}
			</div>
		{/if}

		<div class="mb-4 flex items-start justify-between gap-4">
			<p class="max-w-prose text-sm text-ink-muted">
				Extras a guest can add to a dish: sauces, sides, "make it a set". Build a group once, then
				attach it to as many menu items as you like from the Menu tab.
			</p>
			{#if data.canManageMenu}
				<Button onclick={() => (groupDialog = { open: true, group: null })}>
					<PlusIcon class="size-4" /> New group
				</Button>
			{/if}
		</div>

		{#if data.groups.length === 0}
			<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
				<LayersIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">No add-on groups for {venue.title} yet.</p>
			</div>
		{:else}
			<div class="space-y-6">
				{#each data.groups as g (g.id)}
					<section class="overflow-hidden rounded-xl border border-border" aria-label={g.name}>
						<header class="flex items-center justify-between gap-3 bg-surface-2/60 px-4 py-2.5">
							<div>
								<h2 class="text-sm font-semibold text-ink">{g.name}</h2>
								<p class="text-xs text-ink-muted">{rule(g)}</p>
							</div>
							{#if data.canManageMenu}
								<Button
									variant="ghost"
									size="icon"
									aria-label="Edit group {g.name}"
									onclick={() => (groupDialog = { open: true, group: g })}
								>
									<PencilIcon class="size-4" />
								</Button>
							{/if}
						</header>
						<ul class="divide-y divide-border">
							{#each g.addons as a (a.id)}
								<li class="flex items-center gap-3 px-4 py-2.5">
									<span class="min-w-0 flex-1 text-sm text-ink {a.isAvailable ? '' : 'line-through decoration-ink-muted'}">
										{a.name}
										{#if !a.isAvailable}<span class="ml-1 text-xs text-ink-muted no-underline">Sold out</span>{/if}
									</span>
									<span class="text-sm tabular-nums text-ink-muted">{peso(a.priceCentavos)}</span>
									{#if data.canManageMenu}
										<Button
											variant="ghost"
											size="icon"
											aria-label="Edit {a.name}"
											onclick={() => (addonDialog = { open: true, addon: a })}
										>
											<PencilIcon class="size-4" />
										</Button>
									{/if}
								</li>
							{:else}
								<li class="px-4 py-3 text-sm text-ink-muted">No options in this group yet.</li>
							{/each}
						</ul>
						{#if data.canManageMenu}
							<form
								method="POST"
								action="?/addAddon"
								use:enhance
								class="flex items-end gap-2 border-t border-border px-4 py-3"
							>
								<input type="hidden" name="groupId" value={g.id} />
								<div class="flex-1">
									<Label for="addon-name-{g.id}" class="text-xs">Add an option</Label>
									<Input id="addon-name-{g.id}" name="name" required maxlength={80} placeholder="Extra rice" class="mt-1 h-8" />
								</div>
								<div class="w-28">
									<Label for="addon-price-{g.id}" class="text-xs">Price (₱)</Label>
									<Input
										id="addon-price-{g.id}"
										name="pricePhp"
										type="number"
										min="0"
										step="0.01"
										value="0"
										class="mt-1 h-8 tabular-nums"
									/>
								</div>
								<Button type="submit" size="sm" variant="outline" class="h-8">
									<PlusIcon class="size-4" /> Add
								</Button>
							</form>
						{/if}
					</section>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Group editor -->
<Dialog.Root bind:open={groupDialog.open}>
	<Dialog.Content class="sm:max-w-md">
		{#if data.venue}
			{@const group = groupDialog.group}
			<Dialog.Header>
				<Dialog.Title>{group ? `Edit ${group.name}` : 'New add-on group'}</Dialog.Title>
				<Dialog.Description>
					Leave "fewest" at 0 for optional extras; set it to 1 to make the guest choose.
				</Dialog.Description>
			</Dialog.Header>
			<form
				id="groupForm"
				method="POST"
				action={group ? '?/updateGroup' : '?/createGroup'}
				use:enhance
				class="space-y-3"
			>
				{#if group}
					<input type="hidden" name="groupId" value={group.id} />
				{:else}
					<input type="hidden" name="diningItemId" value={data.venue.id} />
				{/if}
				<div>
					<Label for="groupName">Name</Label>
					<Input id="groupName" name="name" required maxlength={80} value={group?.name ?? ''} placeholder="Choose a side" class="mt-1" />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<Label for="groupMin">Fewest to pick</Label>
						<Input id="groupMin" name="minChoices" type="number" min="0" max="99" value={group?.minChoices ?? 0} class="mt-1" />
					</div>
					<div>
						<Label for="groupMax">Most to pick</Label>
						<Input
							id="groupMax"
							name="maxChoices"
							type="number"
							min="0"
							max="99"
							value={group?.maxChoices ?? ''}
							placeholder="No limit"
							class="mt-1"
						/>
					</div>
				</div>
			</form>
			<Dialog.Footer class="sm:justify-between">
				{#if group}
					<form method="POST" action="?/deleteGroup" use:enhance>
						<input type="hidden" name="groupId" value={group.id} />
						<Button type="submit" variant="ghost" class="text-danger hover:text-danger">
							<Trash2Icon class="size-4" /> Delete group
						</Button>
					</form>
				{:else}
					<span></span>
				{/if}
				<div class="flex gap-2">
					<Button variant="outline" onclick={() => (groupDialog.open = false)}>Cancel</Button>
					<Button type="submit" form="groupForm">{group ? 'Save' : 'Create'}</Button>
				</div>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Add-on editor -->
<Dialog.Root bind:open={addonDialog.open}>
	<Dialog.Content class="sm:max-w-sm">
		{#if addonDialog.addon}
			{@const addon = addonDialog.addon}
			<Dialog.Header>
				<Dialog.Title>Edit {addon.name}</Dialog.Title>
			</Dialog.Header>
			<form id="addonForm" method="POST" action="?/updateAddon" use:enhance class="space-y-3">
				<input type="hidden" name="addonId" value={addon.id} />
				<div>
					<Label for="addonName">Name</Label>
					<Input id="addonName" name="name" required maxlength={80} value={addon.name} class="mt-1" />
				</div>
				<div>
					<Label for="addonPrice">Price (₱)</Label>
					<Input
						id="addonPrice"
						name="pricePhp"
						type="number"
						min="0"
						step="0.01"
						value={(addon.priceCentavos / 100).toFixed(2)}
						class="mt-1 tabular-nums"
					/>
				</div>
				<label class="flex items-center gap-2 text-sm text-ink">
					<input type="checkbox" name="isAvailable" checked={addon.isAvailable} class="size-4" />
					Available today
				</label>
			</form>
			<Dialog.Footer class="sm:justify-between">
				<form method="POST" action="?/deleteAddon" use:enhance>
					<input type="hidden" name="addonId" value={addon.id} />
					<Button type="submit" variant="ghost" class="text-danger hover:text-danger">Remove</Button>
				</form>
				<div class="flex gap-2">
					<Button variant="outline" onclick={() => (addonDialog.open = false)}>Cancel</Button>
					<Button type="submit" form="addonForm">Save</Button>
				</div>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
