<script lang="ts">
	import { page } from '$app/state';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import { SETTINGS_ENTRIES, groupSettingsEntries } from '$lib/settings-nav';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const base = $derived(`/${page.params.hotel}/management`);
	// Only what this person may open; the rail beside this page lists the same entries.
	const groups = $derived(
		groupSettingsEntries(SETTINGS_ENTRIES.filter((e) => data.settingsEntryIds.includes(e.id)))
	);
</script>

<svelte:head><title>Settings</title></svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<h1 class="mb-1 text-xl font-semibold tracking-tight text-ink">Settings</h1>
	<p class="mb-8 text-sm text-ink-muted">
		Everything you can configure for this hotel, in one place. Items marked
		<ArrowUpRightIcon class="inline size-3.5 align-text-bottom" /> open in their own section.
	</p>

	{#each groups as g (g.id)}
		<section class="mb-8" aria-labelledby="settings-{g.id}">
			<h2 id="settings-{g.id}" class="mb-3 text-xs font-medium tracking-wide text-ink-muted uppercase">
				{g.label}
			</h2>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each g.entries as e (e.id)}
					<a
						href="{base}/{e.href}"
						class="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:border-brand/50"
					>
						<div
							class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
						>
							<e.icon class="size-4.5" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="font-medium text-ink">{e.label}</div>
							<p class="mt-0.5 text-sm text-ink-muted">{e.desc}</p>
						</div>
						{#if e.linkOut}
							<ArrowUpRightIcon
								class="mt-2 size-4 shrink-0 text-ink-muted transition group-hover:text-brand"
							/>
						{:else}
							<ArrowRightIcon
								class="mt-2 size-4 shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-brand"
							/>
						{/if}
					</a>
				{/each}
			</div>
		</section>
	{/each}
</div>
