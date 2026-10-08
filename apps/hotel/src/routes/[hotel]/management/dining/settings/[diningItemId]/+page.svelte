<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import ImageIcon from '@lucide/svelte/icons/image';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { DiningPhoto } from '$lib/server/db/schema/dining';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}/management`);
	const item = data.item;
	const photos = $derived((item.photos as DiningPhoto[]) ?? []);

	// Reservation settings (controlled so the preview line updates as you type).
	let resEnabled = $state(item.reservationsEnabled);
	let seatingOpen = $state(item.seatingOpen ?? '');
	let lastSeating = $state(item.lastSeating ?? '');
	let slotMinutes = $state(String(item.slotMinutes));
	let turnMinutes = $state(item.turnMinutes);
	let maxPartySize = $state(item.maxPartySize);
	let advanceDays = $state(item.advanceDays);
	let minNoticeMinutes = $state(item.minNoticeMinutes);
	const preview = $derived(
		seatingOpen && lastSeating
			? `Guests can book from ${seatingOpen} to ${lastSeating} every ${slotMinutes} minutes, parties of up to ${maxPartySize}, each holding a table for ${turnMinutes} minutes. They can book up to ${advanceDays} days ahead, with at least ${minNoticeMinutes} minutes of notice.`
			: 'Set the first and last seating times to see what guests will be offered.'
	);

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
		<Button variant="outline" href="{base}/dining/settings">← Venues</Button>
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
			<Textarea id="description" name="description" rows={3} class="mt-1" value={item.description ?? ''} />
		</div>
		<div>
			<Label for="highlights">Highlights (optional)</Label>
			<Textarea id="highlights" name="highlights" rows={4} placeholder={'Live coffee brewing bar\nAll-day breakfast\nOutdoor seating'} class="mt-1" value={(item.highlights as string[] | null)?.join('\n') ?? ''} />
			<p class="mt-1 text-xs text-ink-muted">
				One per line, up to 6 — shown as a short checklist on the page.
			</p>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<Label class="flex items-center gap-2 text-sm font-normal text-ink">
				<Checkbox name="isActive" checked={item.isActive} value="on" /> Shown on public page
			</Label>
			<div>
				<Label for="sortOrder">Sort order</Label>
				<Input id="sortOrder" name="sortOrder" type="number" min="0" value={item.sortOrder} class="mt-1" />
			</div>
		</div>

		<Button type="submit">Save dining item</Button>
	</form>

	<div class="mt-8 border-t border-border pt-6">
		<h3 class="flex items-center gap-2 text-sm font-semibold text-ink">
			<CalendarClockIcon class="size-4 text-brand" /> Table reservations
		</h3>
		<p class="mt-1 text-xs text-ink-muted">
			Let guests book a table online and let staff take phone bookings. Tables are set up on the
			<a class="underline" href="{base}/dining/floor-plan?venue={item.id}">Floor plan</a>
			({data.tableCount} active {data.tableCount === 1 ? 'table' : 'tables'}).
		</p>

		<form method="POST" action="?/updateReservations" use:enhance class="mt-4 space-y-4">
			<div class="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
				<div>
					<Label for="resEnabled" class="text-sm font-medium text-ink">Take reservations</Label>
					<p class="text-xs text-ink-muted">Needs seating hours and at least one table.</p>
				</div>
				<Switch id="resEnabled" name="reservationsEnabled" bind:checked={resEnabled} />
			</div>

			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div>
					<Label for="seatingOpen">First seating</Label>
					<Input id="seatingOpen" name="seatingOpen" type="time" bind:value={seatingOpen} class="mt-1" />
				</div>
				<div>
					<Label for="lastSeating">Last seating</Label>
					<Input id="lastSeating" name="lastSeating" type="time" bind:value={lastSeating} class="mt-1" />
				</div>
				<div>
					<Label for="slotMinutes">Times every</Label>
					<Select.Root type="single" name="slotMinutes" bind:value={slotMinutes}>
						<Select.Trigger id="slotMinutes" class="mt-1 w-full">{slotMinutes} min</Select.Trigger>
						<Select.Content>
							<Select.Item value="15" label="15 min" />
							<Select.Item value="30" label="30 min" />
							<Select.Item value="60" label="60 min" />
						</Select.Content>
					</Select.Root>
				</div>
				<div>
					<Label for="turnMinutes">Table held (min)</Label>
					<Input id="turnMinutes" name="turnMinutes" type="number" min="30" max="300" step="15" bind:value={turnMinutes} class="mt-1" />
				</div>
				<div>
					<Label for="maxPartySize">Largest party online</Label>
					<Input id="maxPartySize" name="maxPartySize" type="number" min="1" max="50" bind:value={maxPartySize} class="mt-1" />
				</div>
				<div>
					<Label for="advanceDays">Book up to (days ahead)</Label>
					<Input id="advanceDays" name="advanceDays" type="number" min="1" max="365" bind:value={advanceDays} class="mt-1" />
				</div>
				<div>
					<Label for="minNoticeMinutes">Minimum notice (min)</Label>
					<Input id="minNoticeMinutes" name="minNoticeMinutes" type="number" min="0" max="10080" step="15" bind:value={minNoticeMinutes} class="mt-1" />
				</div>
			</div>

			<p class="text-sm text-ink-muted" aria-live="polite">{preview}</p>
			<Button type="submit" size="sm">Save reservation settings</Button>
		</form>
	</div>

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
