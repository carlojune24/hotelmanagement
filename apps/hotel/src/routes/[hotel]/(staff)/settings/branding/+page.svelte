<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import {
		ACCENT_LIGHTNESS,
		ACCENT_PALETTE,
		ACCENT_SATURATION,
		DEFAULT_ACCENT_COLOR,
		DEFAULT_DISPLAY_FONT,
		DEFAULT_PAPER_COLOR,
		DISPLAY_FONT_IDS,
		DISPLAY_FONTS,
		MAX_GALLERY_IMAGES,
		PAPER_LIGHTNESS,
		PAPER_PALETTE,
		PAPER_SATURATION,
		hexToHsl,
		hslToHex
	} from '$lib/branding';
	import LocationPicker from '$lib/components/staff/location-picker.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);

	let contactLat = $state<number | null>(data.branding.contactLat ?? null);
	let contactLng = $state<number | null>(data.branding.contactLng ?? null);

	// Accent color: a curated palette of hues (fixed saturation/lightness, matching
	// DEFAULT_ACCENT_COLOR's own recipe so every pick stays dark enough for white
	// button text) plus a hue slider for fine-tuning, replacing the old plain color
	// input. `accentColor` is still the one value that actually submits — the hex
	// field below stays editable for an exact manual value.
	let accentColor = $state(data.branding.accentColor ?? DEFAULT_ACCENT_COLOR);
	let accentHue = $state(hexToHsl(data.branding.accentColor ?? DEFAULT_ACCENT_COLOR)[0]);
	function pickHue(hue: number) {
		accentHue = hue;
		accentColor = hslToHex(hue, ACCENT_SATURATION, ACCENT_LIGHTNESS);
	}
	const hueTrackBackground = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) =>
		hslToHex(i * 30, ACCENT_SATURATION, ACCENT_LIGHTNESS)
	).join(', ')})`;

	// Background ("paper") color: same palette + hue-slider mechanic as accent, but locked
	// to a light, low-saturation range (PAPER_SATURATION/PAPER_LIGHTNESS) so whatever a hotel
	// picks stays close enough to white that the fixed dark body text and button labels never
	// need a separate contrast check. Unset = pure white, same as before this control existed.
	let paperColor = $state(data.branding.paperColor ?? DEFAULT_PAPER_COLOR);
	let paperHue = $state(hexToHsl(data.branding.paperColor ?? DEFAULT_PAPER_COLOR)[0]);
	function pickPaperHue(hue: number) {
		paperHue = hue;
		paperColor = hslToHex(hue, PAPER_SATURATION, PAPER_LIGHTNESS);
	}
	const paperHueTrackBackground = `linear-gradient(to right, ${Array.from({ length: 13 }, (_, i) =>
		hslToHex(i * 30, PAPER_SATURATION, PAPER_LIGHTNESS)
	).join(', ')})`;

	let fontDisplay = $state(data.branding.fontDisplay ?? DEFAULT_DISPLAY_FONT);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});

	let galleryFileInput = $state<HTMLInputElement | undefined>(undefined);
	let heroVideoFileInput = $state<HTMLInputElement | undefined>(undefined);
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Branding</h1>
			<p class="text-sm text-ink-muted">
				How your hotel presents itself on its public booking page.
			</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<form
		method="POST"
		action="?/updateBranding"
		enctype="multipart/form-data"
		use:enhance
		class="space-y-5"
	>
		<div>
			<Label for="logo">Logo</Label>
			<div class="mt-1 flex items-center gap-3">
				{#if data.branding.logoUrl}
					<img
						src={data.branding.logoUrl}
						alt="Current logo"
						class="h-12 w-12 shrink-0 rounded-md border border-border object-contain p-1"
					/>
				{/if}
				<Input id="logo" name="logo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
				{#if data.branding.logoUrl}
					<Button
						type="submit"
						formaction="?/removeLogo"
						variant="ghost"
						size="sm"
						class="shrink-0 text-ink-muted hover:text-danger"
					>
						Remove
					</Button>
				{/if}
			</div>
			<p class="mt-1 text-xs text-ink-muted">
				Shown beside your hotel name on the booking page. JPEG, PNG, WebP, or GIF, up to 8 MB.
			</p>
		</div>

		<div>
			<Label for="heroImage">Hero image</Label>
			<div class="mt-1 flex items-center gap-3">
				{#if data.branding.heroImageUrl}
					<img
						src={data.branding.heroImageUrl}
						alt="Current hero"
						class="h-12 w-20 shrink-0 rounded-md border border-border object-cover"
					/>
				{/if}
				<Input
					id="heroImage"
					name="heroImage"
					type="file"
					accept="image/jpeg,image/png,image/webp,image/gif"
				/>
				{#if data.branding.heroImageUrl}
					<Button
						type="submit"
						formaction="?/removeHeroImage"
						variant="ghost"
						size="sm"
						class="shrink-0 text-ink-muted hover:text-danger"
					>
						Remove
					</Button>
				{/if}
			</div>
			<p class="mt-1 text-xs text-ink-muted">
				The large image at the top of your booking page. Leave unset to use your accent color's
				woven pattern instead.
			</p>
		</div>

		<div>
			<Label for="accentColor">Accent color</Label>

			<div class="mt-2 flex flex-wrap gap-2">
				{#each ACCENT_PALETTE as preset (preset.name)}
					{@const presetHex = hslToHex(preset.hue, ACCENT_SATURATION, ACCENT_LIGHTNESS)}
					<button
						type="button"
						aria-label={preset.name}
						title={preset.name}
						onclick={() => pickHue(preset.hue)}
						class="size-8 shrink-0 rounded-full border-2 transition"
						style="background: {presetHex}; border-color: {accentHue === preset.hue
							? 'var(--brand)'
							: 'transparent'};"
					></button>
				{/each}
			</div>

			<input
				type="range"
				min="0"
				max="360"
				step="1"
				aria-label="Accent hue"
				bind:value={accentHue}
				oninput={() => pickHue(accentHue)}
				class="mt-3 h-2 w-full max-w-xs cursor-pointer appearance-none rounded-full"
				style="background: {hueTrackBackground};"
			/>

			<div class="mt-3 flex items-center gap-2">
				<div
					class="size-9 shrink-0 rounded-md border border-border"
					style="background: {accentColor};"
				></div>
				<Input id="accentColor" name="accentColor" bind:value={accentColor} class="max-w-40" />
			</div>
			<p class="mt-1 text-xs text-ink-muted">
				Woven into your booking page's hero, section dividers, and confirmation ticket. Pick a
				swatch, fine-tune with the slider, or type an exact hex — buttons use white text on this
				color, so the palette and slider are locked to a shade dark enough to stay readable.
			</p>
		</div>

		<div>
			<Label for="paperColor">Background color</Label>

			<div class="mt-2 flex flex-wrap gap-2">
				{#each PAPER_PALETTE as preset (preset.name)}
					{@const presetHex = hslToHex(preset.hue, PAPER_SATURATION, PAPER_LIGHTNESS)}
					<button
						type="button"
						aria-label={preset.name}
						title={preset.name}
						onclick={() => pickPaperHue(preset.hue)}
						class="size-8 shrink-0 rounded-full border-2 transition"
						style="background: {presetHex}; border-color: {paperHue === preset.hue
							? 'var(--brand)'
							: 'transparent'};"
					></button>
				{/each}
			</div>

			<input
				type="range"
				min="0"
				max="360"
				step="1"
				aria-label="Background hue"
				bind:value={paperHue}
				oninput={() => pickPaperHue(paperHue)}
				class="mt-3 h-2 w-full max-w-xs cursor-pointer appearance-none rounded-full"
				style="background: {paperHueTrackBackground};"
			/>

			<div class="mt-3 flex items-center gap-2">
				<div
					class="size-9 shrink-0 rounded-md border border-border"
					style="background: {paperColor};"
				></div>
				<Input id="paperColor" name="paperColor" bind:value={paperColor} class="max-w-40" />
			</div>
			<p class="mt-1 text-xs text-ink-muted">
				Your booking page's page background. Pick a swatch, fine-tune with the slider, or type an
				exact hex — the palette and slider are locked to a light, subtle tint so your body text
				and buttons stay exactly as readable as they are on plain white.
			</p>
		</div>

		<div>
			<Label>Display font</Label>
			<div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each DISPLAY_FONT_IDS as id (id)}
					<button
						type="button"
						onclick={() => (fontDisplay = id)}
						class="rounded-md border px-3 py-3 text-left transition {fontDisplay === id
							? 'border-brand ring-1 ring-brand'
							: 'border-border hover:border-brand/50'}"
					>
						<div class="text-lg" style="font-family: {DISPLAY_FONTS[id].family};">Aa</div>
						<div class="mt-1 text-xs text-ink-muted">{DISPLAY_FONTS[id].label}</div>
					</button>
				{/each}
			</div>
			<input type="hidden" name="fontDisplay" value={fontDisplay} />
			<p class="mt-1 text-xs text-ink-muted">
				Used for headings, room names, and prices on your public booking page. Body and price/data
				text stay fixed so the type system keeps its contrast.
			</p>
		</div>

		<div>
			<Label for="tagline">Tagline</Label>
			<Input
				id="tagline"
				name="tagline"
				maxlength={140}
				placeholder="A quiet stay above the rice terraces."
				value={data.branding.tagline ?? ''}
				class="mt-1"
			/>
		</div>

		<div>
			<Label for="about">About</Label>
			<!-- No shadcn Textarea is installed in this project; native element matches the rest of this form. -->
			<textarea
				id="about"
				name="about"
				maxlength={1200}
				rows="4"
				placeholder="A short introduction guests see on your public booking page — what the property is, what makes a stay here worthwhile."
				class="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
				>{data.branding.about ?? ''}</textarea
			>
		</div>

		<div class="border-t border-border pt-5">
			<h2 class="text-sm font-semibold text-ink">Check-in &amp; check-out</h2>
			<p class="mt-1 text-xs text-ink-muted">
				Guest-facing copy shown on each room type's detail page — leave it blank to omit that
				block entirely. Standard times and extension fees for the front desk live under
				<a href="{base}/settings/check-in-out" class="underline underline-offset-2">Check-in &amp; check-out policy</a>.
			</p>
			<div class="mt-3">
				<Label for="checkInPolicy">Check-in policy</Label>
				<textarea
					id="checkInPolicy"
					name="checkInPolicy"
					maxlength={500}
					rows="2"
					placeholder="Check-in from 3:00 PM. Early check-in subject to availability."
					class="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
					>{data.branding.checkInPolicy ?? ''}</textarea
				>
			</div>
			<div class="mt-3">
				<Label for="checkOutPolicy">Check-out policy</Label>
				<textarea
					id="checkOutPolicy"
					name="checkOutPolicy"
					maxlength={500}
					rows="2"
					placeholder="Check-out before 11:00 AM. Late check-out subject to availability."
					class="mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
					>{data.branding.checkOutPolicy ?? ''}</textarea
				>
			</div>
		</div>

		<div class="border-t border-border pt-5">
			<h2 class="text-sm font-semibold text-ink">Contact</h2>
			<p class="mt-1 text-xs text-ink-muted">Shown on your public "Contact Us" page.</p>
			<div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<Label for="contactPhone">Phone</Label>
					<Input
						id="contactPhone"
						name="contactPhone"
						type="tel"
						placeholder="+63 82 000 0000"
						value={data.branding.contactPhone ?? ''}
						class="mt-1"
					/>
				</div>
				<div>
					<Label for="contactEmail">Email</Label>
					<Input
						id="contactEmail"
						name="contactEmail"
						type="email"
						placeholder="frontdesk@yourhotel.com"
						value={data.branding.contactEmail ?? ''}
						class="mt-1"
					/>
				</div>
			</div>
			<div class="mt-3">
				<Label for="contactAddress">Address</Label>
				<Input
					id="contactAddress"
					name="contactAddress"
					placeholder="123 Rizal St, Davao City, Philippines"
					value={data.branding.contactAddress ?? ''}
					class="mt-1"
				/>
				<p class="mt-1 text-xs text-ink-muted">
					Shown on the Contact page, and used as the map's fallback when no pin is set below.
				</p>
			</div>
			<div class="mt-3">
				<Label>Map location</Label>
				<p class="mt-1 text-xs text-ink-muted">
					Drop a precise pin for the map on your public Contact page, instead of relying on the
					address above.
				</p>
				<input type="hidden" name="contactLat" value={contactLat ?? ''} />
				<input type="hidden" name="contactLng" value={contactLng ?? ''} />
				<div class="mt-2">
					<LocationPicker bind:lat={contactLat} bind:lng={contactLng} />
				</div>
			</div>
		</div>

		<Button type="submit">Save branding</Button>
	</form>

	<div class="mt-10 border-t border-border pt-8">
		<Label>Hero video (optional)</Label>
		<p class="mt-1 text-xs text-ink-muted">
			Used as your hero's backdrop when set — falls back to the hero image above. MP4 or WebM, up
			to 50 MB.
		</p>

		{#if data.branding.heroVideoUrl}
			<div class="mt-3 flex items-center gap-3">
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					src={data.branding.heroVideoUrl}
					muted
					loop
					autoplay
					playsinline
					class="h-12 w-20 shrink-0 rounded-md border border-border object-cover"
				></video>
				<form method="POST" action="?/removeHeroVideo" use:enhance>
					<Button type="submit" variant="ghost" size="sm" class="text-ink-muted hover:text-danger">
						Remove
					</Button>
				</form>
			</div>
		{/if}

		<form
			method="POST"
			action="?/uploadHeroVideo"
			enctype="multipart/form-data"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					if (heroVideoFileInput) heroVideoFileInput.value = '';
				};
			}}
			class="mt-3 flex items-center gap-2"
		>
			<input
				bind:this={heroVideoFileInput}
				name="heroVideo"
				type="file"
				accept="video/mp4,video/webm"
				class="text-sm"
			/>
			<Button type="submit" variant="outline" size="sm">
				{data.branding.heroVideoUrl ? 'Replace video' : 'Upload video'}
			</Button>
		</form>
	</div>

	<div class="mt-10 border-t border-border pt-8">
		<Label>Gallery photos</Label>
		<p class="mt-1 text-xs text-ink-muted">
			Property shots — lobby, grounds, views — shown alongside your room types' own photos in the
			booking page's gallery. Up to {MAX_GALLERY_IMAGES}.
		</p>

		{#if (data.branding.galleryImages ?? []).length > 0}
			<div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
				{#each data.branding.galleryImages ?? [] as url (url)}
					<div class="group relative">
						<img src={url} alt="" class="aspect-square w-full rounded-md border border-border object-cover" />
						<form method="POST" action="?/removeGalleryImage" use:enhance>
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
			action="?/uploadGalleryImages"
			enctype="multipart/form-data"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					if (galleryFileInput) galleryFileInput.value = '';
				};
			}}
			class="mt-3 flex items-center gap-2"
		>
			<input
				bind:this={galleryFileInput}
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
