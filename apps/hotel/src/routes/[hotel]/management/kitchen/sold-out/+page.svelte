<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import BanIcon from '@lucide/svelte/icons/ban';
	import SearchIcon from '@lucide/svelte/icons/search';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let query = $state('');
	let onlySoldOut = $state(false);
	let busy = $state<string | null>(null);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});

	const soldOut = $derived(data.dishes.filter((d) => !d.isAvailable));
	const shown = $derived(
		data.dishes.filter(
			(d) =>
				(!onlySoldOut || !d.isAvailable) &&
				(query.trim() === '' || d.name.toLowerCase().includes(query.trim().toLowerCase()))
		)
	);
	const venues = $derived(new Set(data.dishes.map((d) => d.venue)).size);

	const groups = $derived.by(() => {
		const byKey = new Map<string, typeof shown>();
		for (const d of shown) byKey.set(d.stationName ?? '', [...(byKey.get(d.stationName ?? '') ?? []), d]);
		const named = [...byKey.keys()].some((k) => k !== '');
		return [...byKey.entries()]
			.sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
			.map(([key, dishes]) => ({ key, label: key || (named ? 'No station' : 'All dishes'), dishes }));
	});
</script>

<svelte:head><title>Sold out · Kitchen</title></svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<div class="max-w-3xl">
		<h2 class="text-base font-semibold text-ink">Sold out today</h2>
		<p class="mt-1 text-sm text-ink-muted">
			Mark a dish sold out the moment you run out. It disappears from the table QR and online menus straight
			away, and waiters see it struck through.
		</p>

		<div
			class="mt-4 rounded-lg border px-4 py-3 {soldOut.length > 0 ? 'border-warning/60 bg-warning/10' : 'border-border bg-surface'}"
			aria-live="polite"
		>
			{#if soldOut.length === 0}
				<p class="flex items-center gap-2 text-sm text-ink"><CheckIcon class="size-4 text-brand" aria-hidden="true" />Everything is available.</p>
			{:else}
				<p class="text-sm font-semibold text-ink">
					<BanIcon class="mr-1 inline size-4" aria-hidden="true" />{soldOut.length} sold out
				</p>
				<p class="mt-1 text-sm text-ink-muted">{soldOut.map((d) => d.name).join(' · ')}</p>
			{/if}
		</div>

		<div class="mt-4 flex flex-wrap items-center gap-3">
			<div class="relative min-w-56 flex-1">
				<SearchIcon class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
				<Input bind:value={query} type="search" placeholder="Search dishes" aria-label="Search dishes" class="h-11 pl-9" />
			</div>
			<Button variant={onlySoldOut ? 'default' : 'outline'} class="h-11" aria-pressed={onlySoldOut} onclick={() => (onlySoldOut = !onlySoldOut)}>
				Sold out only
			</Button>
		</div>
	</div>

	{#each groups as group (group.key)}
		<section class="mt-6 max-w-3xl" aria-labelledby="so-{group.key || 'none'}">
			<h3 id="so-{group.key || 'none'}" class="border-b border-border pb-2 text-sm font-semibold tracking-wide text-ink uppercase">
				{group.label}
				<span class="ml-1 font-normal tabular-nums text-ink-muted">{group.dishes.length}</span>
			</h3>
			<ul class="divide-y divide-border">
				{#each group.dishes as dish (dish.id)}
					<li class="flex items-center gap-3 py-2.5">
						<div class="min-w-0 flex-1">
							<p class="truncate text-base {dish.isAvailable ? 'text-ink' : 'text-ink-muted line-through decoration-1'}">{dish.name}</p>
							{#if venues > 1}<p class="truncate text-xs text-ink-muted">{dish.venue}</p>{/if}
						</div>
						{#if data.canWrite}
							<form
								method="POST"
								action="?/setAvailable"
								use:enhance={() => {
									busy = dish.id;
									return async ({ update }) => {
										await update({ reset: false });
										busy = null;
									};
								}}
							>
								<input type="hidden" name="itemId" value={dish.id} />
								<input type="hidden" name="isAvailable" value={dish.isAvailable ? 'false' : 'true'} />
								<Button
									type="submit"
									variant={dish.isAvailable ? 'outline' : 'default'}
									class="h-11 min-w-36 gap-2"
									disabled={busy !== null}
									aria-label="{dish.name}: {dish.isAvailable ? 'available, mark sold out' : 'sold out, put back on'}"
								>
									{#if dish.isAvailable}
										<CheckIcon class="size-4" aria-hidden="true" />Available
									{:else}
										<BanIcon class="size-4" aria-hidden="true" />Sold out
									{/if}
								</Button>
							</form>
						{:else}
							<span class="text-sm font-medium text-ink-muted">{dish.isAvailable ? 'Available' : 'Sold out'}</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="mt-8 max-w-3xl rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
			{data.dishes.length === 0 ? 'No dishes on the menu yet.' : 'No dishes match.'}
		</p>
	{/each}
</div>
