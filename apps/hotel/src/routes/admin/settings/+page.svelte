<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form && 'ok' in form && form.ok) toast.success(form.ok);
		if (form && 'error' in form && form.error) toast.error(form.error);
	});

	const images = $derived([
		{
			kind: 'logo',
			title: 'Landing page logo',
			help: 'Shown on its own in the header. A wide logo on a transparent background (PNG or WebP) works best.',
			url: data.brand.logoUrl,
			empty: 'No logo yet. The page shows the text name instead.',
			fit: 'max-h-16 w-auto max-w-full object-contain'
		},
		{
			kind: 'hero',
			title: 'Landing page hero photo',
			help: 'The full-width photo behind the welcome message. A wide, dark-toned building or lobby shot works best (at least 1600 px wide).',
			url: data.brand.heroImageUrl,
			empty: 'No photo uploaded. The page shows the default building photo.',
			fit: 'max-h-48 w-full rounded object-cover'
		}
	]);
</script>

<div class="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
	<div>
		<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">Settings</h1>
		<p class="text-sm text-ink-muted">Platform-wide settings for the public landing page at the site root.</p>
	</div>

	{#each images as img (img.kind)}
		<section class="rounded-lg border border-border bg-surface p-5">
			<h2 class="text-sm font-medium text-ink">{img.title}</h2>
			<p class="mt-1 text-sm text-ink-muted">{img.help} Up to 8 MB.</p>

			<div class="mt-4 flex min-h-24 items-center justify-center rounded-md bg-neutral-950 p-4">
				{#if img.url}
					<img src={img.url} alt="Current {img.kind}" class={img.fit} />
				{:else}
					<span class="text-sm text-neutral-400">{img.empty}</span>
				{/if}
			</div>

			<form method="POST" action="?/upload" enctype="multipart/form-data" use:enhance class="mt-4 flex flex-wrap items-center gap-3">
				<input type="hidden" name="kind" value={img.kind} />
				<input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif" required class="text-sm" />
				<Button type="submit">Upload</Button>
			</form>
			{#if img.url}
				<form method="POST" action="?/remove" use:enhance class="mt-3">
					<input type="hidden" name="kind" value={img.kind} />
					<Button type="submit" variant="outline" size="sm">Remove</Button>
				</form>
			{/if}
		</section>
	{/each}
</div>
