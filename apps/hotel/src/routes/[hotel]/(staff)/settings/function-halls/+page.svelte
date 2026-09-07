<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);
	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;

	let createOpen = $state(false);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			createOpen = false;
		}
	});
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Function hall</h1>
			<p class="text-sm text-ink-muted">
				The event space you rent by the hour — pricing, capacity, and what's included.
			</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<div class="flex items-center justify-between gap-4">
		<div>
			<h2 class="text-base font-semibold text-ink">Halls</h2>
			<p class="text-sm text-ink-muted">Most hotels only need one; add more if you have several.</p>
		</div>
		<Button onclick={() => (createOpen = true)}>
			<PlusIcon class="size-4" /> New function hall
		</Button>
	</div>

	<div class="mt-4 overflow-hidden rounded-xl border border-border">
		{#if data.halls.length === 0}
			<div class="flex flex-col items-center gap-2 p-10 text-center">
				<PartyPopperIcon class="size-6 text-ink-muted" />
				<p class="text-sm text-ink-muted">No function hall set up yet.</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>Capacity</Table.Head>
						<Table.Head>Base rate</Table.Head>
						<Table.Head>Extra hour</Table.Head>
						<Table.Head class="text-right">Edit</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.halls as h (h.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium text-ink">{h.name}</div>
								{#if !h.isActive}<div class="text-xs text-ink-muted">Inactive</div>{/if}
							</Table.Cell>
							<Table.Cell class="text-ink-muted">{h.capacity} guests</Table.Cell>
							<Table.Cell class="text-ink-muted"
								>{peso(h.basePriceCentavos)} / {h.baseHours}h</Table.Cell
							>
							<Table.Cell class="text-ink-muted">{peso(h.extraHourFeeCentavos)} / hr</Table.Cell>
							<Table.Cell class="text-right">
								<Button
									variant="ghost"
									size="icon"
									href="{base}/settings/function-halls/{h.id}"
									aria-label="Edit {h.name}"
								>
									<PencilIcon class="size-4" />
								</Button>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>
</div>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New function hall</Dialog.Title>
			<Dialog.Description>You can add photos, included services, and event types after creating it.</Dialog.Description>
		</Dialog.Header>
		<form id="createHallForm" method="POST" action="?/create" use:enhance class="space-y-3">
			<div>
				<Label for="name">Name</Label>
				<Input id="name" name="name" required placeholder="M'M Function Hall" class="mt-1" />
			</div>
			<div>
				<Label for="capacity">Capacity (guests)</Label>
				<Input id="capacity" name="capacity" type="number" min="1" required class="mt-1" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="baseHours">Included hours</Label>
					<Input id="baseHours" name="baseHours" type="number" min="1" required class="mt-1" />
				</div>
				<div>
					<Label for="basePricePhp">Base rental (₱)</Label>
					<Input
						id="basePricePhp"
						name="basePricePhp"
						type="number"
						min="0"
						step="0.01"
						required
						class="mt-1"
					/>
				</div>
			</div>
			<div>
				<Label for="extraHourFeePhp">Extra hour rate (₱ / hour)</Label>
				<Input
					id="extraHourFeePhp"
					name="extraHourFeePhp"
					type="number"
					min="0"
					step="0.01"
					required
					class="mt-1"
				/>
			</div>
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
			<Button type="submit" form="createHallForm">Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
