<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import CalendarClockIcon from '@lucide/svelte/icons/calendar-clock';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import CircleXIcon from '@lucide/svelte/icons/circle-x';
	import SearchIcon from '@lucide/svelte/icons/search';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const base = $derived(`/${page.params.hotel}`);

	const peso = (centavos: number) => `₱${(centavos / 100).toFixed(2)}`;

	let createPlanOpen = $state(false);
	let createPolicyOpen = $state(false);
	let editPolicyOpen = $state(false);

	let planSearch = $state('');
	let planStatusFilter = $state<'all' | 'active' | 'inactive'>('all');
	const statusFilterLabel: Record<string, string> = {
		all: 'All statuses',
		active: 'Active',
		inactive: 'Inactive'
	};

	const activeCount = $derived(data.ratePlans.filter((p) => p.isActive).length);
	const inactiveCount = $derived(data.ratePlans.length - activeCount);

	const filteredPlans = $derived(
		data.ratePlans.filter((p) => {
			const q = planSearch.trim().toLowerCase();
			const matchesSearch =
				q === '' ||
				p.name.toLowerCase().includes(q) ||
				p.roomTypeName.toLowerCase().includes(q) ||
				(p.promoCode ?? '').toLowerCase().includes(q);
			const matchesStatus =
				planStatusFilter === 'all' || (planStatusFilter === 'active') === p.isActive;
			return matchesSearch && matchesStatus;
		})
	);

	let planRoomTypeId = $state('');
	let planPolicyId = $state('');
	let policyPenaltyType = $state<'percentage_of_total' | 'first_night' | 'full_amount'>(
		'full_amount'
	);

	let editPolicyId = $state('');
	let editPolicyName = $state('');
	let editPolicyFreeCancelHours = $state('');
	let editPolicyPenaltyType = $state<'percentage_of_total' | 'first_night' | 'full_amount'>(
		'full_amount'
	);
	let editPolicyPenaltyPct = $state('');
	let editPolicyPenaltyValueBps = $state('');

	function openEditPolicy(c: (typeof data.cancellationPolicies)[number]) {
		editPolicyId = c.id;
		editPolicyName = c.name;
		editPolicyFreeCancelHours = c.freeCancelHours != null ? String(c.freeCancelHours) : '';
		editPolicyPenaltyType = c.penaltyType;
		editPolicyPenaltyValueBps = c.penaltyValueBps != null ? String(c.penaltyValueBps) : '';
		editPolicyPenaltyPct = c.penaltyValueBps != null ? String(c.penaltyValueBps / 100) : '';
		editPolicyOpen = true;
	}

	const penaltyLabel: Record<string, string> = {
		percentage_of_total: 'Percentage of total',
		first_night: 'First night',
		full_amount: 'Full amount'
	};

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) {
			toast.success(form.ok);
			createPlanOpen = false;
			createPolicyOpen = false;
			editPolicyOpen = false;
		}
	});
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Rates & policies</h1>
			<p class="text-sm text-ink-muted">Pricing plans and the cancellation rules they follow.</p>
		</div>
		<Button variant="outline" href="{base}/settings">← Settings</Button>
	</div>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		<div class="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
			<div
				class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
			>
				<WalletIcon class="size-5" />
			</div>
			<div class="min-w-0">
				<div class="text-xl font-semibold text-ink">{data.ratePlans.length}</div>
				<div class="truncate text-xs text-ink-muted">Rate plans</div>
			</div>
		</div>
		<div class="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
			<div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-ok/15 text-ok">
				<CircleCheckIcon class="size-5" />
			</div>
			<div class="min-w-0">
				<div class="text-xl font-semibold text-ink">{activeCount}</div>
				<div class="truncate text-xs text-ink-muted">Active</div>
			</div>
		</div>
		<div class="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
			<div
				class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted"
			>
				<CircleXIcon class="size-5" />
			</div>
			<div class="min-w-0">
				<div class="text-xl font-semibold text-ink">{inactiveCount}</div>
				<div class="truncate text-xs text-ink-muted">Inactive</div>
			</div>
		</div>
		<div class="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
			<div
				class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand"
			>
				<CalendarClockIcon class="size-5" />
			</div>
			<div class="min-w-0">
				<div class="text-xl font-semibold text-ink">{data.cancellationPolicies.length}</div>
				<div class="truncate text-xs text-ink-muted">Cancellation policies</div>
			</div>
		</div>
	</div>

	<section class="mt-8">
		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="text-base font-semibold text-ink">Rate plans</h2>
				<p class="text-sm text-ink-muted">What guests book against — one per room type or promo.</p>
			</div>
			<Button onclick={() => (createPlanOpen = true)} disabled={data.roomTypes.length === 0}>
				<PlusIcon class="size-4" /> New rate plan
			</Button>
		</div>

		{#if data.roomTypes.length === 0}
			<p class="mt-3 text-sm text-ink-muted">
				Create a room type first under <a
					class="text-brand hover:underline"
					href="{base}/settings/rooms">Room types</a
				> before adding a rate plan.
			</p>
		{/if}

		{#if data.ratePlans.length > 0}
			<div class="mt-4 flex items-center gap-3">
				<div class="relative max-w-sm flex-1">
					<SearchIcon class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
					<Input placeholder="Search rate plans…" bind:value={planSearch} class="pl-8" />
				</div>
				<Select.Root type="single" bind:value={planStatusFilter}>
					<Select.Trigger class="w-40 shrink-0"
						>{statusFilterLabel[planStatusFilter]}</Select.Trigger
					>
					<Select.Content>
						<Select.Item value="all" label="All statuses" />
						<Select.Item value="active" label="Active" />
						<Select.Item value="inactive" label="Inactive" />
					</Select.Content>
				</Select.Root>
			</div>
		{/if}

		<div class="mt-4 overflow-hidden rounded-xl border border-border">
			{#if data.ratePlans.length === 0}
				<p class="p-6 text-center text-sm text-ink-muted">No rate plans yet.</p>
			{:else if filteredPlans.length === 0}
				<p class="p-6 text-center text-sm text-ink-muted">No rate plans match your search.</p>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Plan</Table.Head>
							<Table.Head>Room type</Table.Head>
							<Table.Head>Price / night</Table.Head>
							<Table.Head>Cancellation policy</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head class="text-right">Edit</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filteredPlans as p (p.id)}
							<Table.Row>
								<Table.Cell>
									<div class="font-medium text-ink">{p.name}</div>
									{#if p.promoCode}<div class="text-xs text-ink-muted">{p.promoCode}</div>{/if}
								</Table.Cell>
								<Table.Cell class="text-ink-muted">{p.roomTypeName}</Table.Cell>
								<Table.Cell class="text-ink-muted">{peso(p.basePriceCentavos)}</Table.Cell>
								<Table.Cell class="text-ink-muted">{p.cancellationPolicyName ?? '—'}</Table.Cell>
								<Table.Cell>
									<Badge
										variant="outline"
										class={p.isActive
											? 'border-transparent bg-ok/15 text-ok'
											: 'border-border bg-surface-2 text-ink-muted'}
									>
										{p.isActive ? 'Active' : 'Inactive'}
									</Badge>
								</Table.Cell>
								<Table.Cell class="text-right">
									<Button
										variant="ghost"
										size="icon"
										href="{base}/settings/rates/{p.id}"
										aria-label="Edit {p.name}"
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
	</section>

	<section class="mt-10">
		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="text-base font-semibold text-ink">Cancellation policies</h2>
				<p class="text-sm text-ink-muted">Reusable rules a rate plan can point to.</p>
			</div>
			<Button variant="outline" onclick={() => (createPolicyOpen = true)}>
				<PlusIcon class="size-4" /> New policy
			</Button>
		</div>

		<div class="mt-4 overflow-hidden rounded-xl border border-border">
			{#if data.cancellationPolicies.length === 0}
				<p class="p-6 text-center text-sm text-ink-muted">No cancellation policies yet.</p>
			{:else}
				<Table.Root>
					<Table.Body>
						{#each data.cancellationPolicies as c (c.id)}
							<Table.Row>
								<Table.Cell>
									<div class="font-medium text-ink">{c.name}</div>
									<div class="text-xs text-ink-muted">
										{c.freeCancelHours != null
											? `Free up to ${c.freeCancelHours}h before check-in`
											: 'No free cancellation'} · {penaltyLabel[c.penaltyType]}
									</div>
								</Table.Cell>
								<Table.Cell class="text-right">
									<Button
										variant="ghost"
										size="icon"
										aria-label="Edit {c.name}"
										onclick={() => openEditPolicy(c)}
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
	</section>
</div>

<Dialog.Root bind:open={createPlanOpen}>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>New rate plan</Dialog.Title>
			<Dialog.Description>Pricing guests will book against.</Dialog.Description>
		</Dialog.Header>
		<form
			id="createRatePlanForm"
			method="POST"
			action="?/createRatePlan"
			use:enhance
			class="space-y-3"
		>
			<div>
				<Label for="planName">Name</Label>
				<Input id="planName" name="name" required placeholder="Standard Rate" class="mt-1" />
			</div>
			<div>
				<Label for="roomTypeId">Room type</Label>
				<Select.Root type="single" name="roomTypeId" bind:value={planRoomTypeId}>
					<Select.Trigger id="roomTypeId" class="mt-1 w-full">
						{data.roomTypes.find((t) => t.id === planRoomTypeId)?.name ?? 'Select a room type'}
					</Select.Trigger>
					<Select.Content>
						{#each data.roomTypes as t (t.id)}
							<Select.Item value={t.id} label={t.name} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div>
				<Label for="cancellationPolicyId">Cancellation policy</Label>
				<Select.Root type="single" name="cancellationPolicyId" bind:value={planPolicyId}>
					<Select.Trigger id="cancellationPolicyId" class="mt-1 w-full">
						{data.cancellationPolicies.find((c) => c.id === planPolicyId)?.name ?? 'None'}
					</Select.Trigger>
					<Select.Content>
						{#each data.cancellationPolicies as c (c.id)}
							<Select.Item value={c.id} label={c.name} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="basePricePhp">Price / night (₱)</Label>
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
				<div>
					<Label for="promoCode">Promo code</Label>
					<Input id="promoCode" name="promoCode" class="mt-1" />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="extraPersonFeePhp">Extra person fee (₱)</Label>
					<Input
						id="extraPersonFeePhp"
						name="extraPersonFeePhp"
						type="number"
						min="0"
						step="0.01"
						class="mt-1"
					/>
				</div>
				<div>
					<Label for="extraBedFeePhp">Extra bed fee (₱)</Label>
					<Input
						id="extraBedFeePhp"
						name="extraBedFeePhp"
						type="number"
						min="0"
						step="0.01"
						class="mt-1"
					/>
				</div>
				<div>
					<Label for="depositPhp">Deposit (₱)</Label>
					<Input id="depositPhp" name="depositPhp" type="number" min="0" step="0.01" class="mt-1" />
				</div>
			</div>
			<div>
				<Label for="inclusionsCsv">Inclusions (comma-separated)</Label>
				<Input
					id="inclusionsCsv"
					name="inclusionsCsv"
					placeholder="Breakfast, Parking, Welcome drink"
					class="mt-1"
				/>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<Label for="minStayNights">Min stay (nights)</Label>
					<Input id="minStayNights" name="minStayNights" type="number" min="1" class="mt-1" />
				</div>
				<div>
					<Label for="maxStayNights">Max stay (nights)</Label>
					<Input id="maxStayNights" name="maxStayNights" type="number" min="1" class="mt-1" />
				</div>
			</div>
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (createPlanOpen = false)}>Cancel</Button>
			<Button type="submit" form="createRatePlanForm">Create rate plan</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={createPolicyOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New cancellation policy</Dialog.Title>
			<Dialog.Description>A reusable rule any rate plan can point to.</Dialog.Description>
		</Dialog.Header>
		<form id="createPolicyForm" method="POST" action="?/createPolicy" use:enhance class="space-y-3">
			<div>
				<Label for="policyName">Name</Label>
				<Input id="policyName" name="name" required placeholder="Flexible" class="mt-1" />
			</div>
			<div>
				<Label for="freeCancelHours">Free cancellation until (hours before check-in)</Label>
				<Input
					id="freeCancelHours"
					name="freeCancelHours"
					type="number"
					min="0"
					placeholder="Leave blank for none"
					class="mt-1"
				/>
			</div>
			<div>
				<Label for="penaltyType">Penalty</Label>
				<Select.Root type="single" name="penaltyType" bind:value={policyPenaltyType}>
					<Select.Trigger id="penaltyType" class="mt-1 w-full">
						{penaltyLabel[policyPenaltyType]}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="full_amount" label="Full amount" />
						<Select.Item value="first_night" label="First night" />
						<Select.Item value="percentage_of_total" label="Percentage of total" />
					</Select.Content>
				</Select.Root>
			</div>
			{#if policyPenaltyType === 'percentage_of_total'}
				<div>
					<Label for="penaltyValueBpsPct">Penalty percentage</Label>
					<Input
						id="penaltyValueBpsPct"
						type="number"
						min="0"
						max="100"
						step="0.01"
						class="mt-1"
						oninput={(e) => {
							const pct = parseFloat(e.currentTarget.value || '0');
							const hidden = e.currentTarget.form?.elements.namedItem(
								'penaltyValueBps'
							) as HTMLInputElement | null;
							if (hidden) hidden.value = Math.round(pct * 100).toString();
						}}
					/>
					<input type="hidden" id="penaltyValueBps" name="penaltyValueBps" />
				</div>
			{/if}
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (createPolicyOpen = false)}>Cancel</Button>
			<Button type="submit" form="createPolicyForm">Create policy</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={editPolicyOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Edit cancellation policy</Dialog.Title>
			<Dialog.Description>Changes apply to every rate plan pointing at this policy.</Dialog.Description>
		</Dialog.Header>
		<form id="updatePolicyForm" method="POST" action="?/updatePolicy" use:enhance class="space-y-3">
			<input type="hidden" name="id" value={editPolicyId} />
			<div>
				<Label for="editPolicyName">Name</Label>
				<Input id="editPolicyName" name="name" required bind:value={editPolicyName} class="mt-1" />
			</div>
			<div>
				<Label for="editFreeCancelHours">Free cancellation until (hours before check-in)</Label>
				<Input
					id="editFreeCancelHours"
					name="freeCancelHours"
					type="number"
					min="0"
					placeholder="Leave blank for none"
					bind:value={editPolicyFreeCancelHours}
					class="mt-1"
				/>
			</div>
			<div>
				<Label for="editPenaltyType">Penalty</Label>
				<Select.Root type="single" name="penaltyType" bind:value={editPolicyPenaltyType}>
					<Select.Trigger id="editPenaltyType" class="mt-1 w-full">
						{penaltyLabel[editPolicyPenaltyType]}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="full_amount" label="Full amount" />
						<Select.Item value="first_night" label="First night" />
						<Select.Item value="percentage_of_total" label="Percentage of total" />
					</Select.Content>
				</Select.Root>
			</div>
			{#if editPolicyPenaltyType === 'percentage_of_total'}
				<div>
					<Label for="editPenaltyValueBpsPct">Penalty percentage</Label>
					<Input
						id="editPenaltyValueBpsPct"
						type="number"
						min="0"
						max="100"
						step="0.01"
						class="mt-1"
						bind:value={editPolicyPenaltyPct}
						oninput={(e) => {
							const pct = parseFloat(e.currentTarget.value || '0');
							editPolicyPenaltyValueBps = Math.round(pct * 100).toString();
						}}
					/>
					<input type="hidden" name="penaltyValueBps" value={editPolicyPenaltyValueBps} />
				</div>
			{/if}
		</form>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (editPolicyOpen = false)}>Cancel</Button>
			<Button type="submit" form="updatePolicyForm">Save changes</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
