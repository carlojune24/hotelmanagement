<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import ChefHatIcon from '@lucide/svelte/icons/chef-hat';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let newName = $state('');
	let deleting = $state<{ id: string; name: string; dishes: number } | null>(null);
	// Where a deleted station's dishes go; cleared each time the dialog opens or closes.
	let moveTo = $state('');
	$effect(() => {
		void deleting?.id;
		moveTo = '';
	});

	const dishLabel = (n: number) => `${n} ${n === 1 ? 'dish' : 'dishes'}`;

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			newName = '';
			deleting = null;
		}
	});
</script>

<div class="mx-auto w-full max-w-7xl px-4 *:max-w-3xl py-6 sm:px-6">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
		<div class="max-w-md">
			<h2 class="text-base font-semibold text-ink">Stations</h2>
			<p class="mt-1 text-sm text-ink-muted">
				Where dishes are made: Hot Section, Grill, Bar… Each station gets its own lane on the board, and
				every dish belongs to exactly one, set on the Dining menu. Shared by every venue.
			</p>
		</div>

		{#if data.canManage}
			<form method="POST" action="?/createStation" use:enhance class="flex shrink-0 items-center gap-2">
				<Input
					name="name"
					bind:value={newName}
					required
					maxlength={40}
					placeholder="e.g. Hot Section"
					aria-label="New station name"
					class="w-full sm:w-52"
				/>
				<Button type="submit" class="shrink-0">
					<PlusIcon class="size-4" /> Add station
				</Button>
			</form>
		{/if}
	</div>

	{#if data.stations.length === 0}
		<div class="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
			<ChefHatIcon class="size-6 text-ink-muted" />
			<p class="text-sm text-ink-muted">
				No stations yet.{data.canManage ? ' Add your first one above.' : ''}
			</p>
		</div>
	{:else}
		<ul class="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
			{#each data.stations as st (st.id)}
				{@const dishes = data.counts[st.id] ?? 0}
				<li class="flex items-center gap-3 py-1.5 pr-2 pl-2">
					{#if data.canManage}
						<!-- Edit in place: Enter or leaving the field saves a changed name. -->
						<form method="POST" action="?/renameStation" use:enhance class="min-w-0 flex-1">
							<input type="hidden" name="stationId" value={st.id} />
							<Input
								name="name"
								value={st.name}
								maxlength={40}
								aria-label="Station name"
								class="h-9 border-transparent bg-transparent font-medium shadow-none hover:border-input focus-visible:border-ring"
								onblur={(e) => {
									const el = e.currentTarget;
									if (el.value.trim() && el.value.trim() !== st.name) el.form?.requestSubmit();
								}}
							/>
						</form>
					{:else}
						<span class="min-w-0 flex-1 px-3 text-sm font-medium text-ink">{st.name}</span>
					{/if}

					<span class="shrink-0 text-xs tabular-nums text-ink-muted">{dishLabel(dishes)}</span>

					{#if data.canManage}
						<Button
							variant="ghost"
							size="icon"
							class="size-8 shrink-0 text-ink-muted hover:text-danger"
							aria-label="Delete {st.name}"
							onclick={() => (deleting = { id: st.id, name: st.name, dishes })}
						>
							<Trash2Icon class="size-4" />
						</Button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<Dialog.Root open={deleting !== null} onOpenChange={(open) => { if (!open) deleting = null; }}>
	<Dialog.Content class="sm:max-w-sm">
		{#if deleting}
			{@const others = data.stations.filter((s) => s.id !== deleting!.id)}
			<Dialog.Header>
				<Dialog.Title>Delete {deleting.name}?</Dialog.Title>
				<Dialog.Description>
					{deleting.dishes > 0
						? `${dishLabel(deleting.dishes)} ${deleting.dishes === 1 ? 'is' : 'are'} made here. Every dish needs a station, so choose where ${deleting.dishes === 1 ? 'it' : 'they'} should go. Orders still being made move too.`
						: 'No dishes use this station.'}
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/deleteStation" use:enhance class="space-y-4">
				<input type="hidden" name="stationId" value={deleting.id} />
				{#if deleting.dishes > 0}
					{#if others.length === 0}
						<p class="text-sm text-ink-muted">Add another station first, then come back to delete this one.</p>
					{:else}
						<div>
							<Label for="moveTo">Move {dishLabel(deleting.dishes)} to</Label>
							<Select.Root type="single" name="moveTo" bind:value={moveTo}>
								<Select.Trigger id="moveTo" class="mt-1 w-full">{others.find((s) => s.id === moveTo)?.name ?? 'Choose a station'}</Select.Trigger>
								<Select.Content>
									{#each others as s (s.id)}
										<Select.Item value={s.id} label={s.name} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}
				{/if}
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (deleting = null)}>Cancel</Button>
					<Button type="submit" variant="destructive" disabled={deleting.dishes > 0 && !moveTo}>Delete station</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
