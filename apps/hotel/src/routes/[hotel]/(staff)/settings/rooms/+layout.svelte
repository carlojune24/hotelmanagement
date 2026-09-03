<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import SearchIcon from '@lucide/svelte/icons/search';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import UsersIcon from '@lucide/svelte/icons/users';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import ImageIcon from '@lucide/svelte/icons/image';
	import type { LayoutData } from './$types';
	import type { ActionResult } from '@sveltejs/kit';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	const base = $derived(`/${page.params.hotel}`);
	let activeList = $state<'types' | 'rooms'>(page.params.roomTypeId ? 'types' : 'rooms');
	let search = $state('');

	const statusLabel: Record<string, string> = {
		available: 'Available',
		out_of_order: 'Out of order',
		under_maintenance: 'Maintenance'
	};

	const filteredTypes = $derived(
		data.roomTypeList.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
	);
	const filteredRooms = $derived(
		data.roomList.filter(
			(r) =>
				r.roomNumber.toLowerCase().includes(search.toLowerCase()) ||
				r.roomTypeName.toLowerCase().includes(search.toLowerCase())
		)
	);

	let createTypeOpen = $state(false);
	let createRoomOpen = $state(false);
	let newRoomTypeId = $state('');

	function afterCreate(
		closeDialog: () => void,
		pathPrefix: 'types' | 'units',
		idKey: 'createdTypeId' | 'createdRoomId'
	) {
		return () => {
			return async ({ result }: { result: ActionResult }) => {
				if (result.type === 'success' && result.data) {
					toast.success((result.data.ok as string) ?? 'Created.');
					closeDialog();
					await invalidateAll();
					const id = result.data[idKey] as string | undefined;
					if (id) await goto(`${base}/settings/rooms/${pathPrefix}/${id}`);
				} else if (result.type === 'failure') {
					toast.error((result.data?.error as string) ?? 'Something went wrong.');
				}
			};
		};
	}
</script>

<div class="w-full px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Rooms</h1>
			<p class="text-sm text-ink-muted">Manage your rooms and room inventory</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<div class="flex h-[calc(100vh-14rem)] min-h-[32rem] rounded-xl border border-border">
		<div class="flex w-80 shrink-0 flex-col border-r border-border">
			<div class="space-y-3 p-4">
				<div class="inline-flex rounded-lg bg-surface p-1 text-sm">
					<button
						class="rounded-md px-3 py-1.5 font-medium transition {activeList === 'types'
							? 'bg-brand text-brand-ink'
							: 'text-ink-muted hover:text-ink'}"
						onclick={() => (activeList = 'types')}
					>
						Room Types
					</button>
					<button
						class="rounded-md px-3 py-1.5 font-medium transition {activeList === 'rooms'
							? 'bg-brand text-brand-ink'
							: 'text-ink-muted hover:text-ink'}"
						onclick={() => (activeList = 'rooms')}
					>
						Rooms
					</button>
				</div>
				<div class="relative">
					<SearchIcon class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
					<Input placeholder="Search..." bind:value={search} class="pl-8" />
				</div>
				<Button
					class="w-full"
					onclick={() =>
						activeList === 'types' ? (createTypeOpen = true) : (createRoomOpen = true)}
				>
					<PlusIcon />
					{activeList === 'types' ? 'Add room type' : 'Add room'}
				</Button>
			</div>

			<div class="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
				{#if activeList === 'types'}
					{#each filteredTypes as t (t.id)}
						<a
							href="{base}/settings/rooms/types/{t.id}"
							class="block rounded-lg border p-3 transition {page.params.roomTypeId === t.id
								? 'border-brand bg-surface'
								: 'border-border bg-surface/50 hover:border-brand/50'}"
						>
							<div class="flex gap-3">
								<div class="size-12 shrink-0 overflow-hidden rounded-md bg-surface">
									<div class="flex size-full items-center justify-center text-ink-muted">
										<ImageIcon class="size-4" />
									</div>
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1.5">
										<span class="truncate font-medium text-ink">{t.name}</span>
										{#if t.code}<span class="shrink-0 text-xs text-ink-muted">{t.code}</span>{/if}
									</div>
									<div class="text-xs text-ink-muted capitalize">
										{t.category ? `${t.category} · ` : ''}{t.roomCount} room{t.roomCount === 1
											? ''
											: 's'}
									</div>
									<div class="mt-1 flex items-center gap-3 text-xs text-ink-muted">
										<span class="inline-flex items-center gap-1">
											<UsersIcon class="size-3" />{t.maxOccupancy}
										</span>
										{#if t.sizeSqm}
											<span class="inline-flex items-center gap-1">
												<RulerIcon class="size-3" />{t.sizeSqm} m²
											</span>
										{/if}
									</div>
								</div>
							</div>
						</a>
					{:else}
						<p class="px-1 py-6 text-center text-sm text-ink-muted">No room types found.</p>
					{/each}
				{:else}
					{#each filteredRooms as r (r.id)}
						<a
							href="{base}/settings/rooms/units/{r.id}"
							class="block rounded-lg border p-3 transition {page.params.roomId === r.id
								? 'border-brand bg-surface'
								: 'border-border bg-surface/50 hover:border-brand/50'}"
						>
							<div class="flex gap-3">
								<div class="size-12 shrink-0 overflow-hidden rounded-md bg-surface">
									{#if r.photo}
										<img src={r.photo} alt="" class="size-full object-cover" />
									{:else}
										<div class="flex size-full items-center justify-center text-ink-muted">
											<ImageIcon class="size-4" />
										</div>
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center justify-between gap-2">
										<div class="truncate font-medium text-ink">{r.roomNumber}</div>
										<Badge
											variant="outline"
											class={!r.isActive
												? 'border-border bg-surface-2 text-ink-muted'
												: r.operationalStatus === 'available'
													? 'border-transparent bg-ok/15 text-ok'
													: 'border-transparent bg-danger/10 text-danger'}
										>
											{!r.isActive
												? 'Inactive'
												: (statusLabel[r.operationalStatus] ?? r.operationalStatus)}
										</Badge>
									</div>
									<div class="truncate text-xs text-ink-muted">{r.roomTypeName}</div>
									<div class="mt-1 flex items-center gap-3 text-xs text-ink-muted">
										{#if r.maxOccupancy}
											<span class="inline-flex items-center gap-1">
												<UsersIcon class="size-3" />{r.maxOccupancy}
											</span>
										{/if}
										{#if r.sizeSqm}
											<span class="inline-flex items-center gap-1">
												<RulerIcon class="size-3" />{r.sizeSqm} m²
											</span>
										{/if}
									</div>
								</div>
							</div>
						</a>
					{:else}
						<p class="px-1 py-6 text-center text-sm text-ink-muted">No rooms found.</p>
					{/each}
				{/if}
			</div>

			<div class="border-t border-border px-4 py-3 text-xs text-ink-muted">
				{activeList === 'types' ? filteredTypes.length : filteredRooms.length} total
			</div>
		</div>

		<div class="min-w-0 flex-1 overflow-y-auto p-6">
			{#key page.params.roomTypeId ?? page.params.roomId ?? 'empty'}
				{@render children()}
			{/key}
		</div>
	</div>
</div>

<Dialog.Root bind:open={createTypeOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add room type</Dialog.Title>
			<Dialog.Description>Create a new sellable room product.</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="{base}/settings/rooms?/createType"
			use:enhance={afterCreate(() => (createTypeOpen = false), 'types', 'createdTypeId')}
			class="space-y-3"
		>
			<div>
				<Label for="newTypeName">Name</Label>
				<Input id="newTypeName" name="name" required placeholder="Deluxe Twin" class="mt-1" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="newTypeBase">Base occupancy</Label>
					<Input
						id="newTypeBase"
						name="baseOccupancy"
						type="number"
						min="1"
						max="20"
						value="2"
						required
						class="mt-1"
					/>
				</div>
				<div>
					<Label for="newTypeMax">Max occupancy</Label>
					<Input
						id="newTypeMax"
						name="maxOccupancy"
						type="number"
						min="1"
						max="20"
						value="2"
						required
						class="mt-1"
					/>
				</div>
			</div>
			<Dialog.Footer>
				<Button type="submit">Create</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={createRoomOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add room</Dialog.Title>
			<Dialog.Description>Add a physical room to inventory.</Dialog.Description>
		</Dialog.Header>
		<form
			method="POST"
			action="{base}/settings/rooms?/createRoom"
			use:enhance={afterCreate(() => (createRoomOpen = false), 'units', 'createdRoomId')}
			class="space-y-3"
		>
			<div>
				<Label for="newRoomType">Room type</Label>
				<Select.Root type="single" name="roomTypeId" bind:value={newRoomTypeId}>
					<Select.Trigger id="newRoomType" class="mt-1 w-full">
						{data.roomTypeOptions.find((t) => t.id === newRoomTypeId)?.name ?? 'Select a room type'}
					</Select.Trigger>
					<Select.Content>
						{#each data.roomTypeOptions as t (t.id)}
							<Select.Item value={t.id} label={t.name} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="newRoomNumber">Room number</Label>
					<Input id="newRoomNumber" name="roomNumber" required placeholder="101" class="mt-1" />
				</div>
				<div>
					<Label for="newRoomFloor">Floor</Label>
					<Input id="newRoomFloor" name="floor" placeholder="1" class="mt-1" />
				</div>
			</div>
			<div>
				<Label for="newRoomBuilding">Building block</Label>
				<Input id="newRoomBuilding" name="buildingBlock" placeholder="A" class="mt-1" />
			</div>
			<Dialog.Footer>
				<Button type="submit">Create</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
