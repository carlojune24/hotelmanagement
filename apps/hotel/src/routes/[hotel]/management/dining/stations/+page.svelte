<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ChefHatIcon from '@lucide/svelte/icons/chef-hat';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let newName = $state('');

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			newName = '';
		}
	});
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
	<p class="max-w-prose text-sm text-ink-muted">
		Where dishes are prepared: Kitchen, Bar, Pastry. Tag each menu item with a station so
		sales can be reported by station, and so the kitchen board can be split later. Stations
		are shared by every venue.
	</p>

	{#if data.stations.length === 0}
		<div class="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
			<ChefHatIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">No stations yet.{data.canManageMenu ? ' Add your first below.' : ''}</p>
		</div>
	{:else}
		<ul class="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
			{#each data.stations as st (st.id)}
				<li class="flex items-center gap-3 px-4 py-2.5">
					{#if data.canManageMenu}
						<form method="POST" action="?/renameStation" use:enhance class="flex flex-1 items-center gap-2">
							<input type="hidden" name="stationId" value={st.id} />
							<Input name="name" value={st.name} maxlength={40} aria-label="Station name" class="h-8 max-w-xs" />
							<Button type="submit" size="sm" variant="outline" class="h-8">Rename</Button>
						</form>
					{:else}
						<span class="flex-1 text-sm font-medium text-ink">{st.name}</span>
					{/if}
					<span class="w-20 text-right text-xs tabular-nums text-ink-muted">
						{data.counts[st.id] ?? 0}
						{(data.counts[st.id] ?? 0) === 1 ? 'dish' : 'dishes'}
					</span>
					{#if data.canManageMenu}
						<form method="POST" action="?/deleteStation" use:enhance>
							<input type="hidden" name="stationId" value={st.id} />
							<Button type="submit" size="sm" variant="ghost" class="h-8 text-danger hover:text-danger">
								Delete
							</Button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.canManageMenu}
		<form method="POST" action="?/createStation" use:enhance class="mt-5 flex items-end gap-2">
			<div class="flex-1 max-w-xs">
				<Label for="newStation" class="text-xs">New station</Label>
				<Input id="newStation" name="name" bind:value={newName} required maxlength={40} placeholder="Kitchen" class="mt-1 h-8" />
			</div>
			<Button type="submit" size="sm" class="h-8">Add station</Button>
		</form>
	{/if}
</div>
