<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import StatBar from '$lib/components/stat-bar.svelte';
	import RulerIcon from '@lucide/svelte/icons/ruler';
	import UsersIcon from '@lucide/svelte/icons/users';
	import UserIcon from '@lucide/svelte/icons/user';
	import BedIcon from '@lucide/svelte/icons/bed';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import AccessibilityIcon from '@lucide/svelte/icons/accessibility';
	import ImageIcon from '@lucide/svelte/icons/image';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import type { ActionData, PageData } from './$types';
	import type { BedConfigEntry, RoomPhoto } from '$lib/server/db/schema/inventory';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	// The layout keys this page on data.room.id, so the component (and this
	// seed-once local state) fully remounts when navigating between rooms.
	const r = $derived(data.room);
	const t = $derived(data.roomType);

	let status = $state<'available' | 'out_of_order' | 'under_maintenance'>(r.operationalStatus);
	let photos = $state<RoomPhoto[]>((r.photos as RoomPhoto[]) ?? []);
	let activeTab = $state('overview');

	const statusLabel: Record<string, string> = {
		available: 'Available',
		out_of_order: 'Out of Order',
		under_maintenance: 'Under Maintenance'
	};

	function addPhoto() {
		photos = [...photos, { url: '', tag: 'cover' }];
	}
	function removePhoto(i: number) {
		photos = photos.filter((_, idx) => idx !== i);
	}

	const bedSummary = $derived.by(() => {
		const beds = (t?.bedConfiguration as BedConfigEntry[] | undefined) ?? [];
		return beds.length === 0 ? '—' : beds.map((b) => `${b.quantity} ${b.type}`).join(', ');
	});
	const primaryPlan = $derived(
		data.ratePlans
			.filter((p) => p.isActive)
			.sort((a, b) => a.basePriceCentavos - b.basePriceCentavos)[0] ?? null
	);
	const peso = (c: number) => `₱${(c / 100).toFixed(2)}`;
	const vatPct = $derived((data.vatRateBps / 100).toFixed(0));

	const viewTypeLabel: Record<string, string> = {
		'': 'None',
		sea_view: 'Sea View',
		mountain_view: 'Mountain View',
		city_view: 'City View',
		pool_view: 'Pool View',
		garden_view: 'Garden View'
	};

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="flex items-center justify-between gap-4">
	<div>
		<div class="flex items-center gap-2">
			<h2 class="text-lg font-semibold text-ink">Room {r.roomNumber}</h2>
			<Badge
				variant="outline"
				class={r.operationalStatus === 'available'
					? 'border-transparent bg-ok/15 text-ok'
					: 'border-transparent bg-danger/10 text-danger'}
			>
				{statusLabel[r.operationalStatus] ?? r.operationalStatus}
			</Badge>
			{#if !r.isActive}
				<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted">Inactive</Badge>
			{/if}
			{#if r.isConnecting}
				<Badge variant="outline" class="border-border bg-surface-2 text-ink-muted">Connecting</Badge
				>
			{/if}
		</div>
		<p class="text-sm text-ink-muted">
			{t?.name ?? '—'}
			{#if r.floor}· Floor {r.floor}{/if}
			{#if r.buildingBlock}· Building {r.buildingBlock}{/if}
		</p>
	</div>
	<Button variant="outline" href="{base}/settings/rooms">← Back to rooms</Button>
</div>

{#if t}
	<StatBar
		stats={[
			{ icon: RulerIcon, value: `${t.sizeSqm ?? '—'} m²`, label: 'Room Size' },
			{ icon: UserIcon, value: String(t.baseOccupancy), label: 'Base Occupancy' },
			{ icon: UsersIcon, value: String(t.maxOccupancy), label: 'Max Occupancy' },
			{ icon: BedIcon, value: bedSummary, label: 'Bed Configuration' },
			{
				icon: WalletIcon,
				value: primaryPlan ? peso(primaryPlan.basePriceCentavos) : '—',
				label: 'Base Rate / Night'
			}
		]}
	/>
{/if}

<form id="roomForm" method="POST" action="?/update" use:enhance class="mt-6">
	<input type="hidden" name="photosJson" value={JSON.stringify(photos)} />

	<Tabs.Root bind:value={activeTab}>
		<Tabs.List>
			<Tabs.Trigger value="overview">Overview</Tabs.Trigger>
			<Tabs.Trigger value="media">Media</Tabs.Trigger>
			<Tabs.Trigger value="status">Status & Operations</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="overview" class="mt-4 space-y-4">
			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
					<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
						<RulerIcon class="size-4 text-brand" /> Basic Information
					</h3>
					<div class="mt-3 grid grid-cols-2 gap-3">
						<div>
							<Label for="roomNumber">Room number / name</Label>
							<Input id="roomNumber" name="roomNumber" value={r.roomNumber} required class="mt-1" />
						</div>
						<div>
							<span class="mb-1 block text-sm font-medium text-ink">Room category / type</span>
							{#if t}
								<a
									href="{base}/settings/rooms/types/{t.id}"
									class="mt-1 inline-flex h-9 items-center rounded-md border border-border px-3 text-sm text-brand hover:underline"
								>
									{t.name}
								</a>
							{/if}
						</div>
						<div>
							<Label for="floor">Floor level</Label>
							<Input id="floor" name="floor" value={r.floor ?? ''} class="mt-1" />
						</div>
						<div>
							<Label for="buildingBlock">Building block</Label>
							<Input
								id="buildingBlock"
								name="buildingBlock"
								value={r.buildingBlock ?? ''}
								class="mt-1"
							/>
						</div>
					</div>
					<div class="mt-3">
						<Label for="notes">Notes</Label>
						<Input id="notes" name="notes" value={r.notes ?? ''} class="mt-1" />
					</div>
				</div>

				{#if t}
					<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
						<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
							<UsersIcon class="size-4 text-brand" /> Occupancy & Capacity
						</h3>
						<dl class="mt-3 space-y-2 text-sm">
							<div class="flex justify-between gap-2">
								<dt class="text-ink-muted">Base Occupancy</dt>
								<dd class="text-ink">{t.baseOccupancy} Guests</dd>
							</div>
							<div class="flex justify-between gap-2">
								<dt class="text-ink-muted">Max Occupancy</dt>
								<dd class="text-ink">{t.maxOccupancy} Guests</dd>
							</div>
							<div class="flex justify-between gap-2">
								<dt class="text-ink-muted">Max Adults</dt>
								<dd class="text-ink">{t.maxAdults ?? '—'}</dd>
							</div>
							<div class="flex justify-between gap-2">
								<dt class="text-ink-muted">Max Children</dt>
								<dd class="text-ink">{t.maxChildren ?? '—'}</dd>
							</div>
							<div class="flex justify-between gap-2">
								<dt class="text-ink-muted">Extra Bed Policy</dt>
								<dd class="text-ink">{t.extraBedAllowed ? 'Yes' : 'No'}</dd>
							</div>
						</dl>
					</div>
				{/if}
			</div>

			{#if t}
				<div class="rounded-xl border border-border bg-surface-2 p-4 shadow-sm">
					<div class="grid gap-4 divide-border sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
						<div class="lg:pr-4">
							<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
								<BedIcon class="size-4 text-brand" /> Bedding
							</h3>
							<div class="mt-3 flex flex-wrap gap-1.5">
								{#each t.bedConfiguration as BedConfigEntry[] as bed, i (i)}
									<span
										class="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-ink"
									>
										{bed.quantity}
										{bed.type}
									</span>
								{:else}
									<p class="text-sm text-ink-muted">—</p>
								{/each}
							</div>
							{#if t.flexibilityNote}
								<p class="mt-2 text-xs text-ink-muted">{t.flexibilityNote}</p>
							{/if}
						</div>

						<div class="lg:px-4">
							<div class="flex items-center justify-between">
								<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
									<WalletIcon class="size-4 text-brand" /> Pricing
								</h3>
								<a href="{base}/settings/rates" class="text-xs text-brand hover:underline">
									Manage →
								</a>
							</div>
							{#if primaryPlan}
								<dl class="mt-3 space-y-2 text-sm">
									<div class="flex justify-between gap-2">
										<dt class="text-ink-muted">Base Rate</dt>
										<dd class="text-ink">{peso(primaryPlan.basePriceCentavos)}</dd>
									</div>
									<div class="flex justify-between gap-2">
										<dt class="text-ink-muted">Currency</dt>
										<dd class="text-ink">{data.currency}</dd>
									</div>
									<div class="flex justify-between gap-2">
										<dt class="text-ink-muted">Extra Person Fee</dt>
										<dd class="text-ink">
											{primaryPlan.extraPersonFeeCentavos != null
												? peso(primaryPlan.extraPersonFeeCentavos)
												: '—'}
										</dd>
									</div>
									<div class="flex justify-between gap-2">
										<dt class="text-ink-muted">Tax Class</dt>
										<dd class="text-ink">{vatPct}% VAT</dd>
									</div>
									<div class="flex justify-between gap-2">
										<dt class="text-ink-muted">Deposit</dt>
										<dd class="text-ink">
											{primaryPlan.depositCentavos != null
												? peso(primaryPlan.depositCentavos)
												: '—'}
										</dd>
									</div>
								</dl>
							{:else}
								<p class="mt-2 text-sm text-ink-muted">No rate plan yet.</p>
							{/if}
						</div>

						<div class="lg:px-4">
							<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
								<SparklesIcon class="size-4 text-brand" /> Amenities
							</h3>
							<div class="mt-3 space-y-2 text-sm">
								{#if data.roomTypeAmenities.length === 0}
									<p class="text-ink-muted">No amenities listed.</p>
								{:else}
									<div class="flex flex-wrap gap-1.5">
										{#each data.roomTypeAmenities as a (a.name)}
											<span
												class="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-ink"
											>
												{a.name}
											</span>
										{/each}
									</div>
								{/if}
								<div class="flex justify-between gap-2 pt-1">
									<dt class="text-ink-muted">View Type</dt>
									<dd class="text-ink">{viewTypeLabel[t.viewType ?? ''] ?? 'None'}</dd>
								</div>
								<div class="flex justify-between gap-2">
									<dt class="text-ink-muted">Smoking</dt>
									<dd class="text-ink">
										{t.smokingPolicy === 'non_smoking' ? 'Non-Smoking' : 'Smoking Allowed'}
									</dd>
								</div>
							</div>
						</div>

						<div class="lg:pl-4">
							<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
								<AccessibilityIcon class="size-4 text-brand" /> Accessibility
							</h3>
							<dl class="mt-3 space-y-2 text-sm">
								<div class="flex justify-between gap-2">
									<dt class="text-ink-muted">Wheelchair</dt>
									<dd class="text-ink">{t.wheelchairAccessible ? 'Yes' : 'No'}</dd>
								</div>
								<div class="flex justify-between gap-2">
									<dt class="text-ink-muted">Roll-in Shower</dt>
									<dd class="text-ink">{t.rollInShower ? 'Yes' : 'No'}</dd>
								</div>
								<div class="flex justify-between gap-2">
									<dt class="text-ink-muted">Grab Bars</dt>
									<dd class="text-ink">{t.grabBars ? 'Yes' : 'No'}</dd>
								</div>
							</dl>
						</div>
					</div>
				</div>
			{/if}

			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<div class="flex items-center justify-between">
					<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
						<ImageIcon class="size-4 text-brand" /> Marketing Content
					</h3>
					<button
						type="button"
						class="text-xs text-brand hover:underline"
						onclick={() => (activeTab = 'media')}
					>
						Edit →
					</button>
				</div>
				<div class="mt-3 grid gap-4 sm:grid-cols-[1fr_auto]">
					<div class="space-y-1 text-sm">
						<div class="font-medium text-ink">{r.displayTitle || `Room ${r.roomNumber}`}</div>
						{#if r.tagline}<p class="text-ink-muted">{r.tagline}</p>{/if}
					</div>
					{#if photos.length > 0}
						<div class="flex gap-1.5">
							{#each photos.slice(0, 4) as photo, i (i)}
								<div class="size-12 overflow-hidden rounded-md border border-border bg-surface-2">
									{#if photo.url}
										<img src={photo.url} alt="" class="size-full object-cover" />
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</Tabs.Content>

		<Tabs.Content value="media" class="mt-4 space-y-4">
			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
					<ImageIcon class="size-4 text-brand" /> Marketing Content
				</h3>
				<div class="mt-3 space-y-3">
					<div>
						<Label for="displayTitle">Display title</Label>
						<Input
							id="displayTitle"
							name="displayTitle"
							value={r.displayTitle ?? ''}
							placeholder="Comfortable Deluxe Twin Room with City View"
							class="mt-1"
						/>
					</div>
					<div>
						<Label for="tagline">Tagline</Label>
						<Input
							id="tagline"
							name="tagline"
							value={r.tagline ?? ''}
							placeholder="Relax in comfort with modern amenities and great views."
							class="mt-1"
						/>
					</div>
					<div>
						<Label for="shortDescription">Short description</Label>
						<textarea
							id="shortDescription"
							name="shortDescription"
							rows="2"
							class="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
							>{r.shortDescription ?? ''}</textarea
						>
					</div>
				</div>
			</div>

			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
					<ImageIcon class="size-4 text-brand" /> Photos & Gallery
				</h3>
				<div class="mt-3 space-y-2">
					{#each photos as photo, i (i)}
						<div class="flex items-center gap-2">
							<Input bind:value={photo.url} placeholder="https://…" class="flex-[2]" />
							<Input bind:value={photo.tag} placeholder="cover" class="flex-1" />
							<Button
								type="button"
								variant="outline"
								size="icon"
								onclick={() => removePhoto(i)}
								aria-label="Remove photo"
							>
								<XIcon class="size-4" />
							</Button>
						</div>
					{/each}
					<Button type="button" variant="outline" onclick={addPhoto}>
						<PlusIcon class="size-4" /> Add photo URL
					</Button>
					<p class="text-xs text-ink-muted">
						Pasted image URLs only for now — upload storage isn't wired up yet.
					</p>
				</div>
			</div>
		</Tabs.Content>

		<Tabs.Content value="status" class="mt-4 space-y-4">
			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
					<CircleDotIcon class="size-4 text-brand" /> Operational Status
				</h3>
				<div class="mt-3">
					<Label for="operationalStatus">Status</Label>
					<Select.Root type="single" name="operationalStatus" bind:value={status}>
						<Select.Trigger id="operationalStatus" class="mt-1 w-full">
							{statusLabel[status] ?? 'Available'}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="available" label="Available" />
							<Select.Item value="out_of_order" label="Out of Order" />
							<Select.Item value="under_maintenance" label="Under Maintenance" />
						</Select.Content>
					</Select.Root>
					<p class="mt-1 text-xs text-ink-muted">
						Only <span class="font-medium">Available</span> rooms show up in availability searches. Housekeeping
						states (dirty / clean / inspected) arrive with Phase 2.
					</p>
				</div>
			</div>

			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
					<CircleDotIcon class="size-4 text-brand" /> Inventory & Layout
				</h3>
				<p class="mt-1 text-xs text-ink-muted">
					Whether this room counts toward bookable inventory, and how it's laid out relative to
					other rooms.
				</p>
				<div class="mt-3 space-y-3">
					<div>
						<label class="flex items-center gap-2 text-sm text-ink">
							<input type="checkbox" name="isActive" checked={r.isActive} class="size-4" />
							Active — part of bookable inventory
						</label>
						<p class="mt-1 pl-6 text-xs text-ink-muted">
							Deactivate to pull this room out of service long-term (renovation, decommissioned,
							etc.) without deleting its booking history. This works alongside, not instead of,
							the <span class="font-medium">Operational Status</span> above — a room only shows up
							in guest availability searches when it's both <span class="font-medium">Active</span>
							and <span class="font-medium">Available</span>. Use Operational Status for short-term,
							day-to-day states (a maintenance issue, temporarily out of order); use Active for
							longer-term "this room isn't part of inventory right now."
						</p>
					</div>
					<div>
						<label class="flex items-center gap-2 text-sm text-ink">
							<input type="checkbox" name="isConnecting" checked={r.isConnecting} class="size-4" />
							Has a connecting door to an adjacent room
						</label>
						<p class="mt-1 pl-6 text-xs text-ink-muted">
							Informational only — flags this as a physically adjoining room so front desk can
							offer it alongside its pair to families or groups who want to book two connecting
							rooms. It doesn't link the two rooms in the system or affect search/pricing; front
							desk still books each room separately and pairs them manually.
						</p>
					</div>
					<div>
						<Label for="sortOrder">Sort order</Label>
						<Input id="sortOrder" name="sortOrder" type="number" min="0" value={r.sortOrder} class="mt-1" />
						<p class="mt-1 text-xs text-ink-muted">
							Lower numbers list first — within the same floor on the front desk's room grid, and
							in this settings list. Rooms with the same sort order fall back to room number.
						</p>
					</div>
				</div>
			</div>
		</Tabs.Content>
	</Tabs.Root>
</form>

<Separator class="my-6" />

<div class="flex items-center justify-between">
	<form method="POST" action="?/delete" use:enhance>
		<Button variant="destructive" type="submit">Delete room</Button>
	</form>
	<Button type="submit" form="roomForm">Save Changes</Button>
</div>
