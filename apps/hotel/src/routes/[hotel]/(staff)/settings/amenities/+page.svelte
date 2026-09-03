<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import SearchIcon from '@lucide/svelte/icons/search';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);

	type Row = PageData['groups'][number]['items'][number];

	const scopeLabel: Record<string, string> = {
		hotel: 'Hotel-wide',
		room_type: 'Room type',
		both: 'Either'
	};

	// Total matrix columns: name + hotel-wide + one per room type + actions.
	const colCount = $derived(data.roomTypes.length + 3);

	// --- Filters ---
	let search = $state('');
	let categoryFilter = $state<string>('all');

	const filteredGroups = $derived(
		data.groups
			.map((g) => ({
				...g,
				items: g.items.filter((r) => {
					const q = search.trim().toLowerCase();
					const matchesSearch = q === '' || r.name.toLowerCase().includes(q);
					const matchesCategory = categoryFilter === 'all' || g.key === categoryFilter;
					return matchesSearch && matchesCategory;
				})
			}))
			.filter((g) => g.items.length > 0)
	);
	const visibleCount = $derived(filteredGroups.reduce((n, g) => n + g.items.length, 0));

	// --- Add / edit dialog ---
	let dialogOpen = $state(false);
	let editing = $state<Row | null>(null);
	let fName = $state('');
	let fCategory = $state<string>('general');
	let fScope = $state<string>('both');
	let fIcon = $state('');
	let fDescription = $state('');
	let fActive = $state(true);

	function openAdd() {
		editing = null;
		fName = '';
		fCategory = 'general';
		fScope = 'both';
		fIcon = '';
		fDescription = '';
		fActive = true;
		dialogOpen = true;
	}
	function openEdit(row: Row) {
		editing = row;
		fName = row.name;
		fCategory = row.category;
		fScope = row.scope;
		fIcon = row.icon ?? '';
		fDescription = row.description ?? '';
		fActive = row.isActive;
		dialogOpen = true;
	}

	const categoryLabelOf = (v: string) =>
		data.categoryOptions.find((c) => c.value === v)?.label ?? v;

	type EnhanceCb = {
		result: { type: string; data?: Record<string, unknown> };
		update: () => Promise<void>;
	};

	// Add / edit / delete / load-standard: confirm on success, close the dialog.
	function submitFeedback() {
		return async ({ result, update }: EnhanceCb) => {
			if (result.type === 'success') {
				toast.success((result.data?.ok as string) ?? 'Saved.');
				dialogOpen = false;
			} else if (result.type === 'failure') {
				toast.error((result.data?.error as string) ?? 'Something went wrong.');
			}
			await update();
		};
	}

	// Inline matrix checkboxes: terse confirm, snap the box back on failure.
	function toggleFeedback() {
		return async ({ result, update }: EnhanceCb) => {
			if (result.type === 'success') {
				toast.success((result.data?.ok as string) ?? 'Saved.');
			} else if (result.type === 'failure') {
				toast.error((result.data?.error as string) ?? 'Could not save that change.');
			}
			await update();
		};
	}
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-start justify-between gap-4">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Amenities</h1>
			<p class="mt-0.5 max-w-2xl text-sm text-ink-muted">
				Your master list of guest-facing features. Tick
				<span class="font-medium text-ink">Hotel-wide</span> for things the whole property offers, or
				tick a room type for features only those rooms have. Changes save as you click.
			</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<div class="mb-4 flex flex-wrap items-center gap-2">
		<Button onclick={openAdd}>
			<PlusIcon class="size-4" /> Add amenity
		</Button>
		<form method="POST" action="?/loadStandard" use:enhance={submitFeedback}>
			<Button type="submit" variant="outline">
				<DownloadIcon class="size-4" />
				{data.total === 0 ? 'Load standard set' : 'Add missing standard amenities'}
			</Button>
		</form>
		<span class="ml-auto text-xs text-ink-muted">{data.total} total</span>
	</div>

	{#if data.total === 0}
		<div class="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
			<SparklesIcon class="mx-auto size-6 text-ink-muted" />
			<p class="mt-2 text-sm text-ink-muted">
				No amenities yet. Load the standard set to get ~40 common ones, or add your own.
			</p>
		</div>
	{:else}
		<div class="mb-3 flex flex-wrap items-center gap-3">
			<div class="relative max-w-xs flex-1">
				<SearchIcon class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
				<Input placeholder="Search amenities…" bind:value={search} class="pl-8" />
			</div>
			<Select.Root type="single" bind:value={categoryFilter}>
				<Select.Trigger class="w-44 shrink-0">
					{categoryFilter === 'all' ? 'All categories' : categoryLabelOf(categoryFilter)}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="All categories" />
					{#each data.categoryOptions as c (c.value)}
						<Select.Item value={c.value} label={c.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		{#if data.roomTypes.length === 0}
			<p class="mb-3 text-xs text-ink-muted">
				No room types yet — <a class="text-brand hover:underline" href="{base}/settings/rooms"
					>add room types</a
				> to place amenities on specific rooms.
			</p>
		{/if}

		<div class="overflow-hidden rounded-xl border border-border">
			<Table.Root class="min-w-max">
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head class="sticky left-0 z-20 bg-surface">Amenity</Table.Head>
						<Table.Head class="border-l border-border text-center">Hotel-wide</Table.Head>
						{#each data.roomTypes as rt (rt.id)}
							<Table.Head class="text-center font-medium">
								<span class="mx-auto block max-w-[9rem] truncate" title={rt.name}>{rt.name}</span>
							</Table.Head>
						{/each}
						<Table.Head class="sticky right-0 z-20 bg-surface">
							<span class="sr-only">Row actions</span>
						</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each filteredGroups as group (group.key)}
						<Table.Row class="hover:bg-transparent">
							<Table.Cell
								colspan={colCount}
								class="bg-surface-2 py-1.5 text-xs font-semibold tracking-wide text-ink-muted uppercase"
							>
								{group.label}
							</Table.Cell>
						</Table.Row>
						{#each group.items as row (row.id)}
							<Table.Row class="group">
								<Table.Cell class="sticky left-0 z-10 bg-surface group-hover:bg-surface-2">
									<div class="flex items-center gap-2">
										<span class="font-medium text-ink">{row.name}</span>
										{#if !row.isActive}
											<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted">
												Hidden
											</Badge>
										{/if}
									</div>
									{#if row.scope !== 'both'}
										<span class="text-xs text-ink-muted">
											{row.scope === 'hotel' ? 'Hotel-wide only' : 'Room-type only'}
										</span>
									{/if}
								</Table.Cell>

								<Table.Cell class="border-l border-border text-center">
									{#if row.scope === 'room_type'}
										<span class="text-ink-muted/40" aria-hidden="true">—</span>
									{:else}
										<form
											method="POST"
											action="?/toggleHotelWide"
											use:enhance={toggleFeedback}
											class="inline-block"
										>
											<input type="hidden" name="id" value={row.id} />
											<input type="hidden" name="on" value={row.hotelWide ? 'false' : 'true'} />
											<input
												type="checkbox"
												checked={row.hotelWide}
												onchange={(e) => e.currentTarget.form?.requestSubmit()}
												aria-label="{row.name} offered hotel-wide"
												class="size-4 align-middle"
											/>
										</form>
									{/if}
								</Table.Cell>

								{#each data.roomTypes as rt (rt.id)}
									<Table.Cell class="text-center">
										{#if row.scope === 'hotel'}
											<span class="text-ink-muted/40" aria-hidden="true">—</span>
										{:else}
											{@const on = row.roomTypeIds.includes(rt.id)}
											<form
												method="POST"
												action="?/toggleRoomType"
												use:enhance={toggleFeedback}
												class="inline-block"
											>
												<input type="hidden" name="amenityId" value={row.id} />
												<input type="hidden" name="roomTypeId" value={rt.id} />
												<input type="hidden" name="on" value={on ? 'false' : 'true'} />
												<input
													type="checkbox"
													checked={on}
													onchange={(e) => e.currentTarget.form?.requestSubmit()}
													aria-label="{row.name} in {rt.name}"
													class="size-4 align-middle"
												/>
											</form>
										{/if}
									</Table.Cell>
								{/each}

								<Table.Cell class="sticky right-0 z-10 bg-surface group-hover:bg-surface-2">
									<div class="flex items-center justify-end gap-0.5">
										<Button
											variant="ghost"
											size="icon"
											onclick={() => openEdit(row)}
											aria-label="Edit {row.name}"
										>
											<PencilIcon class="size-4" />
										</Button>
										<form
											method="POST"
											action="?/remove"
											use:enhance={submitFeedback}
											class="inline-block"
										>
											<input type="hidden" name="id" value={row.id} />
											<Button
												variant="ghost"
												size="icon"
												type="submit"
												aria-label="Delete {row.name}"
												class="text-ink-muted hover:text-danger"
											>
												<Trash2Icon class="size-4" />
											</Button>
										</form>
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					{/each}

					{#if visibleCount === 0}
						<Table.Row class="hover:bg-transparent">
							<Table.Cell colspan={colCount} class="py-10 text-center text-sm text-ink-muted">
								No amenities match your filters.
							</Table.Cell>
						</Table.Row>
					{/if}
				</Table.Body>
			</Table.Root>
		</div>

		<p class="mt-2 text-xs text-ink-muted">
			A dash (—) means the amenity's scope rules that placement out. Change scope with the
			<PencilIcon class="inline size-3 -translate-y-px" /> edit action.
		</p>
	{/if}
</div>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{editing ? 'Edit amenity' : 'Add amenity'}</Dialog.Title>
			<Dialog.Description>
				Descriptive only — things guests pay extra for belong in a rate plan's inclusions.
			</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action={editing ? '?/update' : '?/create'}
			use:enhance={submitFeedback}
			class="space-y-3"
		>
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
			<div>
				<Label for="amName">Name</Label>
				<Input
					id="amName"
					name="name"
					bind:value={fName}
					required
					placeholder="Free WiFi"
					class="mt-1"
				/>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="amCategory">Category</Label>
					<Select.Root type="single" name="category" bind:value={fCategory}>
						<Select.Trigger id="amCategory" class="mt-1 w-full">
							{categoryLabelOf(fCategory)}
						</Select.Trigger>
						<Select.Content>
							{#each data.categoryOptions as c (c.value)}
								<Select.Item value={c.value} label={c.label} />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div>
					<Label for="amScope">Applies to</Label>
					<Select.Root type="single" name="scope" bind:value={fScope}>
						<Select.Trigger id="amScope" class="mt-1 w-full">{scopeLabel[fScope]}</Select.Trigger>
						<Select.Content>
							<Select.Item value="both" label="Either" />
							<Select.Item value="hotel" label="Hotel-wide" />
							<Select.Item value="room_type" label="Room type" />
						</Select.Content>
					</Select.Root>
				</div>
			</div>
			<div>
				<Label for="amIcon">Icon <span class="text-ink-muted">(Lucide name, optional)</span></Label>
				<Input id="amIcon" name="icon" bind:value={fIcon} placeholder="wifi" class="mt-1" />
			</div>
			<div>
				<Label for="amDesc">Description <span class="text-ink-muted">(optional)</span></Label>
				<Input id="amDesc" name="description" bind:value={fDescription} class="mt-1" />
			</div>
			{#if editing}
				<label class="flex items-center gap-2 text-sm text-ink">
					<input type="checkbox" name="isActive" bind:checked={fActive} class="size-4" />
					Active (offer in pickers)
				</label>
			{/if}
			<Dialog.Footer>
				<Button type="submit">{editing ? 'Save' : 'Add'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
