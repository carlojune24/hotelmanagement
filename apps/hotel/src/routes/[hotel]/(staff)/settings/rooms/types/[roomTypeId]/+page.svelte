<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
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
	import StarIcon from '@lucide/svelte/icons/star';
	import AccessibilityIcon from '@lucide/svelte/icons/accessibility';
	import ImageIcon from '@lucide/svelte/icons/image';
	import type { ActionData, PageData } from './$types';
	import type { BedConfigEntry, RoomPhoto } from '$lib/server/db/schema/inventory';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	// The layout keys this page on data.roomType.id, so the component (and this
	// seed-once local state) fully remounts when navigating between room types.
	const t = $derived(data.roomType);

	let beds = $state<BedConfigEntry[]>((t.bedConfiguration as BedConfigEntry[]) ?? []);
	let photos = $state<RoomPhoto[]>((t.photos as RoomPhoto[]) ?? []);
	let viewType = $state(t.viewType ?? '');

	// Amenity picker — seeded once from load data (the page remounts per room type).
	const selectedAmenityIds = new SvelteSet(data.selectedAmenities.map((a) => a.amenityId));
	const highlightedAmenityIds = new SvelteSet(
		data.selectedAmenities.filter((a) => a.isHighlighted).map((a) => a.amenityId)
	);
	const allAmenities = $derived(data.amenityGroups.flatMap((g) => g.items));
	const selectedAmenityNames = $derived(
		allAmenities.filter((a) => selectedAmenityIds.has(a.id)).map((a) => a.name)
	);

	function toggleAmenity(id: string) {
		if (selectedAmenityIds.has(id)) {
			selectedAmenityIds.delete(id);
			highlightedAmenityIds.delete(id);
		} else {
			selectedAmenityIds.add(id);
		}
	}
	function toggleHighlight(id: string) {
		if (highlightedAmenityIds.has(id)) {
			highlightedAmenityIds.delete(id);
		} else {
			highlightedAmenityIds.add(id);
			selectedAmenityIds.add(id);
		}
	}
	let smoking = $state<'non_smoking' | 'smoking_allowed'>(t.smokingPolicy);
	let category = $state(t.category ?? '');

	const categoryLabel: Record<string, string> = {
		'': 'Uncategorised',
		standard: 'Standard',
		deluxe: 'Deluxe',
		suite: 'Suite',
		executive: 'Executive'
	};

	function addPhoto() {
		photos = [...photos, { url: '', tag: 'cover' }];
	}
	function removePhoto(i: number) {
		photos = photos.filter((_, idx) => idx !== i);
	}

	const bedSummary = $derived(
		beds.length === 0 ? '—' : beds.map((b) => `${b.quantity} ${b.type}`).join(', ')
	);
	// The room type's cheapest active rate plan — used as the "primary" plan for the
	// Pricing & Revenue summary. A type can have several plans; this is just the default.
	const primaryPlan = $derived(
		data.ratePlans
			.filter((p) => p.isActive)
			.sort((a, b) => a.basePriceCentavos - b.basePriceCentavos)[0] ?? null
	);
	const fromRate = $derived(primaryPlan?.basePriceCentavos ?? null);
	const peso = (c: number) => `₱${(c / 100).toFixed(2)}`;
	const vatPct = $derived((data.vatRateBps / 100).toFixed(0));

	let activeTab = $state('overview');

	const viewTypeLabel: Record<string, string> = {
		'': 'None',
		sea_view: 'Sea View',
		mountain_view: 'Mountain View',
		city_view: 'City View',
		pool_view: 'Pool View',
		garden_view: 'Garden View'
	};

	function addBed() {
		beds = [...beds, { type: 'King', quantity: 1 }];
	}
	function removeBed(i: number) {
		beds = beds.filter((_, idx) => idx !== i);
	}

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="flex items-center justify-between gap-4">
	<div>
		<h2 class="text-lg font-semibold text-ink">{t.name}</h2>
		<p class="text-sm text-ink-muted">
			{data.hasRooms ? 'In use' : 'No rooms yet'} · Room type
		</p>
	</div>
	<Button variant="outline" href="{base}/settings/rooms">← Back to rooms</Button>
</div>

<StatBar
	stats={[
		{ icon: RulerIcon, value: `${t.sizeSqm ?? '—'} m²`, label: 'Room Size' },
		{ icon: UserIcon, value: String(t.baseOccupancy), label: 'Base Occupancy' },
		{ icon: UsersIcon, value: String(t.maxOccupancy), label: 'Max Occupancy' },
		{ icon: BedIcon, value: bedSummary, label: 'Bed Configuration' },
		{ icon: WalletIcon, value: fromRate != null ? peso(fromRate) : '—', label: 'Base Rate / Night' }
	]}
/>

<form id="roomTypeForm" method="POST" action="?/update" use:enhance class="mt-6">
	<input type="hidden" name="bedConfigurationJson" value={JSON.stringify(beds)} />
	<input type="hidden" name="photosJson" value={JSON.stringify(photos)} />
	{#each [...selectedAmenityIds] as id (id)}
		<input type="hidden" name="amenityIds" value={id} />
	{/each}
	{#each [...highlightedAmenityIds] as id (id)}
		<input type="hidden" name="highlightIds" value={id} />
	{/each}

	<Tabs.Root bind:value={activeTab}>
		<Tabs.List>
			<Tabs.Trigger value="overview">Overview</Tabs.Trigger>
			<Tabs.Trigger value="amenities">Amenities</Tabs.Trigger>
			<Tabs.Trigger value="rates">Rates & Policies</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="overview" class="mt-4 space-y-4">
			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
					<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
						<RulerIcon class="size-4 text-brand" /> Basic Information
					</h3>
					<div class="mt-3 space-y-3">
						<div>
							<Label for="name">Room type name</Label>
							<Input id="name" name="name" value={t.name} required class="mt-1" />
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div>
								<Label for="code">Short code</Label>
								<Input
									id="code"
									name="code"
									value={t.code ?? ''}
									placeholder="DLX-K"
									class="mt-1"
								/>
							</div>
							<div>
								<Label for="categoryTrigger">Category / class</Label>
								<Select.Root type="single" name="category" bind:value={category}>
									<Select.Trigger id="categoryTrigger" class="mt-1 w-full">
										{categoryLabel[category] ?? 'Uncategorised'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="" label="Uncategorised" />
										<Select.Item value="standard" label="Standard" />
										<Select.Item value="deluxe" label="Deluxe" />
										<Select.Item value="suite" label="Suite" />
										<Select.Item value="executive" label="Executive" />
									</Select.Content>
								</Select.Root>
							</div>
						</div>
						<div>
							<Label for="sizeSqm">Room size (m²)</Label>
							<Input
								id="sizeSqm"
								name="sizeSqm"
								type="number"
								min="0"
								value={t.sizeSqm ?? ''}
								class="mt-1"
							/>
						</div>
						<div>
							<Label for="description">Detailed description</Label>
							<textarea
								id="description"
								name="description"
								rows="3"
								class="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
								>{t.description ?? ''}</textarea
							>
						</div>
					</div>
				</div>

				<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
					<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
						<UsersIcon class="size-4 text-brand" /> Occupancy & Capacity
					</h3>
					<div class="mt-3 grid grid-cols-2 gap-3">
						<div>
							<Label for="baseOccupancy">Base occupancy</Label>
							<Input
								id="baseOccupancy"
								name="baseOccupancy"
								type="number"
								min="1"
								max="20"
								value={t.baseOccupancy}
								required
								class="mt-1"
							/>
						</div>
						<div>
							<Label for="maxOccupancy">Max occupancy</Label>
							<Input
								id="maxOccupancy"
								name="maxOccupancy"
								type="number"
								min="1"
								max="20"
								value={t.maxOccupancy}
								required
								class="mt-1"
							/>
						</div>
						<div>
							<Label for="maxAdults">Max adults</Label>
							<Input
								id="maxAdults"
								name="maxAdults"
								type="number"
								min="0"
								max="20"
								value={t.maxAdults ?? ''}
								class="mt-1"
							/>
						</div>
						<div>
							<Label for="maxChildren">Max children</Label>
							<Input
								id="maxChildren"
								name="maxChildren"
								type="number"
								min="0"
								max="20"
								value={t.maxChildren ?? ''}
								class="mt-1"
							/>
						</div>
					</div>
					<label class="mt-3 flex items-center gap-2 text-sm text-ink">
						<input
							type="checkbox"
							name="extraBedAllowed"
							checked={t.extraBedAllowed}
							class="size-4"
						/>
						Extra bed policy allowed
					</label>
					<div class="mt-2">
						<Label for="maxExtraBeds">Max extra beds</Label>
						<Input
							id="maxExtraBeds"
							name="maxExtraBeds"
							type="number"
							min="0"
							max="10"
							value={t.maxExtraBeds ?? ''}
							class="mt-1"
						/>
					</div>
				</div>
			</div>

			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
					<BedIcon class="size-4 text-brand" /> Bedding Configuration
				</h3>
				<div class="mt-3 space-y-2">
					{#each beds as bed, i (i)}
						<div class="flex items-center gap-2">
							<Input bind:value={bed.type} placeholder="King" class="flex-1" />
							<Input type="number" min="1" bind:value={bed.quantity} class="w-20" />
							<Button
								type="button"
								variant="outline"
								size="icon"
								onclick={() => removeBed(i)}
								aria-label="Remove bed"
							>
								<XIcon class="size-4" />
							</Button>
						</div>
					{/each}
					<Button type="button" variant="outline" onclick={addBed}>
						<PlusIcon class="size-4" /> Add bed type
					</Button>
				</div>
				<label class="mt-3 flex items-center gap-2 text-sm text-ink">
					<input type="checkbox" name="bedFlexible" checked={t.bedFlexible} class="size-4" />
					Flexible configuration (can be converted)
				</label>
				<div class="mt-2">
					<Label for="flexibilityNote">Flexibility note</Label>
					<Input
						id="flexibilityNote"
						name="flexibilityNote"
						value={t.flexibilityNote ?? ''}
						placeholder="Can be converted into 2 Single Beds"
						class="mt-1"
					/>
				</div>
			</div>

			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
					<ImageIcon class="size-4 text-brand" /> Photos & Gallery
				</h3>
				<p class="mt-1 text-xs text-ink-muted">
					Guests and OTAs compare by room type — these are the gallery images for every room of this
					type.
				</p>
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

			<div class="rounded-xl border border-border bg-surface-2 p-4 shadow-sm">
				<div class="grid gap-4 divide-border lg:grid-cols-3 lg:divide-x">
					<div class="lg:pr-4">
						<div class="flex items-center justify-between">
							<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
								<WalletIcon class="size-4 text-brand" /> Pricing & Revenue
							</h3>
							<a href="{base}/settings/rates" class="text-xs text-brand hover:underline">
								Manage →
							</a>
						</div>
						{#if primaryPlan}
							<dl class="mt-3 space-y-2 text-sm">
								<div class="flex justify-between gap-2">
									<dt class="text-ink-muted">Base Rate / Rack Rate</dt>
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
									<dt class="text-ink-muted">Tax Class & Service Charges</dt>
									<dd class="text-ink">{vatPct}% VAT</dd>
								</div>
								<div class="flex justify-between gap-2">
									<dt class="text-ink-muted">Deposit Requirement</dt>
									<dd class="text-ink">
										{primaryPlan.depositCentavos != null ? peso(primaryPlan.depositCentavos) : '—'}
									</dd>
								</div>
							</dl>
						{:else}
							<p class="mt-2 text-sm text-ink-muted">
								No rate plan yet — <a
									href="{base}/settings/rates"
									class="text-brand hover:underline">create one</a
								>.
							</p>
						{/if}
					</div>

					<div class="lg:px-4">
						<div class="flex items-center justify-between">
							<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
								<SparklesIcon class="size-4 text-brand" /> Amenities & Features
							</h3>
							<button
								type="button"
								class="text-xs text-brand hover:underline"
								onclick={() => (activeTab = 'amenities')}
							>
								Edit →
							</button>
						</div>
						<div class="mt-3 space-y-2 text-sm">
							{#if selectedAmenityNames.length === 0}
								<p class="text-ink-muted">No amenities listed.</p>
							{:else}
								<div class="flex flex-wrap gap-1.5">
									{#each selectedAmenityNames as a (a)}
										<span
											class="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-ink"
										>
											{a}
										</span>
									{/each}
								</div>
							{/if}
							<div class="flex justify-between gap-2 pt-1">
								<dt class="text-ink-muted">View Type</dt>
								<dd class="text-ink">{viewTypeLabel[t.viewType ?? ''] ?? 'None'}</dd>
							</div>
							<div class="flex justify-between gap-2">
								<dt class="text-ink-muted">Smoking Policy</dt>
								<dd class="text-ink">
									{t.smokingPolicy === 'non_smoking' ? 'Non-Smoking' : 'Smoking Allowed'}
								</dd>
							</div>
						</div>
					</div>

					<div class="lg:pl-4">
						<div class="flex items-center justify-between">
							<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
								<AccessibilityIcon class="size-4 text-brand" /> Accessibility
							</h3>
							<button
								type="button"
								class="text-xs text-brand hover:underline"
								onclick={() => (activeTab = 'amenities')}
							>
								Edit →
							</button>
						</div>
						<dl class="mt-3 space-y-2 text-sm">
							<div class="flex justify-between gap-2">
								<dt class="text-ink-muted">Wheelchair Accessible</dt>
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
		</Tabs.Content>

		<Tabs.Content value="amenities" class="mt-4 space-y-4">
			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<div class="flex items-center justify-between gap-2">
					<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
						<SparklesIcon class="size-4 text-brand" /> Amenities
					</h3>
					<a href="{base}/settings/amenities" class="text-xs text-brand hover:underline">
						Manage list →
					</a>
				</div>
				<p class="mt-1 text-xs text-ink-muted">
					Tick what every room of this type includes. Use the <StarIcon
						class="inline size-3 -translate-y-px"
					/> to highlight the few that show on the room card; the rest sit behind “See all amenities”.
				</p>

				{#if data.amenityGroups.length === 0}
					<p class="mt-3 text-sm text-ink-muted">
						No amenities defined yet — <a
							href="{base}/settings/amenities"
							class="text-brand hover:underline">set up your list</a
						> first.
					</p>
				{:else}
					<div class="mt-4 space-y-4">
						{#each data.amenityGroups as group (group.key)}
							<div>
								<div
									class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
								>
									{group.label}
								</div>
								<div class="mt-2 grid gap-1.5 sm:grid-cols-2">
									{#each group.items as a (a.id)}
										{@const on = selectedAmenityIds.has(a.id)}
										{@const hi = highlightedAmenityIds.has(a.id)}
										<div
											class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition {on
												? 'border-brand/40 bg-brand/5'
												: 'border-border bg-surface'}"
										>
											<label class="flex flex-1 items-center gap-2">
												<input
													type="checkbox"
													checked={on}
													onchange={() => toggleAmenity(a.id)}
													class="size-4"
												/>
												<span class="text-ink">{a.name}</span>
											</label>
											<button
												type="button"
												onclick={() => toggleHighlight(a.id)}
												aria-label={hi ? 'Remove highlight' : 'Highlight on room card'}
												aria-pressed={hi}
												class="rounded p-0.5 transition {hi
													? 'text-amber-500'
													: 'text-ink-muted/50 hover:text-ink-muted'}"
											>
												<StarIcon class="size-4" fill={hi ? 'currentColor' : 'none'} />
											</button>
										</div>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
					<SparklesIcon class="size-4 text-brand" /> View & Smoking
				</h3>
				<div class="mt-3 space-y-3">
					<div class="grid grid-cols-2 gap-3">
						<div>
							<Label for="viewType">View type</Label>
							<Select.Root type="single" name="viewType" bind:value={viewType}>
								<Select.Trigger id="viewType" class="mt-1 w-full">
									{viewTypeLabel[viewType] ?? 'None'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="" label="None" />
									<Select.Item value="sea_view" label="Sea View" />
									<Select.Item value="mountain_view" label="Mountain View" />
									<Select.Item value="city_view" label="City View" />
									<Select.Item value="pool_view" label="Pool View" />
									<Select.Item value="garden_view" label="Garden View" />
								</Select.Content>
							</Select.Root>
						</div>
						<div>
							<Label for="smokingPolicy">Smoking policy</Label>
							<Select.Root type="single" name="smokingPolicy" bind:value={smoking}>
								<Select.Trigger id="smokingPolicy" class="mt-1 w-full">
									{smoking === 'non_smoking' ? 'Non-Smoking' : 'Smoking Allowed'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="non_smoking" label="Non-Smoking" />
									<Select.Item value="smoking_allowed" label="Smoking Allowed" />
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				</div>
			</div>

			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
					<AccessibilityIcon class="size-4 text-brand" /> Accessibility
				</h3>
				<div class="mt-3 space-y-2">
					<label class="flex items-center gap-2 text-sm text-ink">
						<input
							type="checkbox"
							name="wheelchairAccessible"
							checked={t.wheelchairAccessible}
							class="size-4"
						/>
						Wheelchair Accessible
					</label>
					<label class="flex items-center gap-2 text-sm text-ink">
						<input type="checkbox" name="rollInShower" checked={t.rollInShower} class="size-4" />
						Roll-in Shower
					</label>
					<label class="flex items-center gap-2 text-sm text-ink">
						<input type="checkbox" name="grabBars" checked={t.grabBars} class="size-4" />
						Grab Bars
					</label>
				</div>
			</div>
		</Tabs.Content>

		<Tabs.Content value="rates" class="mt-4">
			<div class="rounded-xl border border-border bg-surface p-4 shadow-sm">
				<div class="flex items-center justify-between">
					<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
						<WalletIcon class="size-4 text-brand" /> Rate plans
					</h3>
					<Button variant="outline" href="{base}/settings/rates">Manage rates</Button>
				</div>
				{#if data.ratePlans.length === 0}
					<p class="mt-2 text-sm text-ink-muted">No rate plans for this room type yet.</p>
				{:else}
					<ul class="mt-3 divide-y divide-border">
						{#each data.ratePlans as p (p.id)}
							<li class="flex items-center justify-between py-2">
								<a
									href="{base}/settings/rates/{p.id}"
									class="text-sm font-medium text-brand hover:underline"
								>
									{p.name}
								</a>
								<span class="text-sm text-ink-muted">{peso(p.basePriceCentavos)} / night</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</Tabs.Content>
	</Tabs.Root>
</form>

<Separator class="my-6" />

<div class="flex items-center justify-between">
	<form method="POST" action="?/delete" use:enhance>
		<Button variant="destructive" type="submit" disabled={data.hasRooms}>Delete room type</Button>
		{#if data.hasRooms}
			<span class="ml-2 text-xs text-ink-muted">Remove all rooms of this type first.</span>
		{/if}
	</form>
	<Button type="submit" form="roomTypeForm">Save Changes</Button>
</div>
