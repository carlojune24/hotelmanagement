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
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">Settings</h1>
	<p class="mb-6 text-sm text-ink-muted">Platform-wide settings for the public landing page at the site root.</p>

	<section class="rounded-lg border border-border bg-surface p-5">
		<h2 class="text-sm font-medium text-ink">Landing page logo</h2>
		<p class="mt-1 text-sm text-ink-muted">
			Shown on its own in the header of the public page that lists the group's hotels. A wide logo on a
			transparent background (PNG or WebP) works best, up to 8 MB.
		</p>

		<div class="mt-4 flex min-h-24 items-center justify-center rounded-md bg-neutral-950 p-4">
			{#if data.logoUrl}
				<img src={data.logoUrl} alt="Current logo" class="max-h-16 w-auto max-w-full object-contain" />
			{:else}
				<span class="text-sm text-neutral-400">No logo yet. The page shows the text name instead.</span>
			{/if}
		</div>

		<form method="POST" action="?/uploadLogo" enctype="multipart/form-data" use:enhance class="mt-4 flex flex-wrap items-center gap-3">
			<input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/gif" required class="text-sm" />
			<Button type="submit">Upload</Button>
		</form>
		{#if data.logoUrl}
			<form method="POST" action="?/removeLogo" use:enhance class="mt-3">
				<Button type="submit" variant="outline" size="sm">Remove logo</Button>
			</form>
		{/if}
	</section>
</div>
