<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { TIMEZONES } from '$lib/authz';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Row = PageData['establishments'][number];
	type Kind = 'all' | 'hotel' | 'business';

	let query = $state('');
	let kindFilter = $state<Kind>('all');
	let dialogOpen = $state(false);
	let editing = $state<Row | null>(null);
	let kind = $state<'hotel' | 'business'>('hotel');
	let busy = $state(false);

	const rows = $derived(
		data.establishments.filter(
			(r) =>
				(kindFilter === 'all' || r.kind === kindFilter) &&
				r.name.toLowerCase().includes(query.trim().toLowerCase())
		)
	);

	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
	const fieldError = (name: string): string | undefined =>
		(form as { errors?: Record<string, string[] | undefined> } | null)?.errors?.[name]?.[0];

	function openCreate() {
		editing = null;
		kind = 'hotel';
		dialogOpen = true;
	}
	function openEdit(row: Row) {
		editing = row;
		dialogOpen = true;
	}
</script>

<svelte:head><title>Establishments · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<h1 class="text-5xl font-light tracking-tight">Establishments</h1>

	<section class="panel space-y-5 p-5 md:p-6" aria-label="Establishments">
		<div class="flex flex-wrap items-center gap-3">
			<div class="relative min-w-52 flex-1">
				<SearchIcon class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-ink-muted" />
				<Input
					type="search"
					placeholder="Search establishments"
					aria-label="Search establishments"
					class="pl-10"
					bind:value={query}
				/>
			</div>

			<div class="flex gap-2" role="group" aria-label="Filter by kind">
				{#each [['all', 'All'], ['hotel', 'Hotels'], ['business', 'Businesses']] as [value, label] (value)}
					<Button
						variant={kindFilter === value ? 'default' : 'outline'}
						size="sm"
						aria-pressed={kindFilter === value}
						onclick={() => (kindFilter = value as Kind)}>{label}</Button
					>
				{/each}
			</div>

			{#if data.canWrite}
				<Button variant="gold" onclick={openCreate}><PlusIcon /> Add establishment</Button>
			{/if}
		</div>

		{#if data.establishments.length === 0}
			<div class="hatch rounded-2xl px-6 py-14 text-center">
				<p class="text-lg">No establishments yet</p>
				<p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
					Add each hotel or business HR is run for. Staff are assigned to an establishment, and
					managers only see their own.
				</p>
			</div>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>Name</Table.Head>
						<Table.Head>Kind</Table.Head>
						<Table.Head>Timezone</Table.Head>
						<Table.Head>Reference</Table.Head>
						<Table.Head>Status</Table.Head>
						{#if data.canWrite}<Table.Head class="w-12"><span class="sr-only">Actions</span></Table.Head>{/if}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as row (row.id)}
						<Table.Row>
							<Table.Cell class="font-medium"><a href="/{row.slug}/employees" class="underline-offset-4 hover:underline">{row.name}</a></Table.Cell>
							<Table.Cell>{row.kind === 'hotel' ? 'Hotel' : 'Business'}</Table.Cell>
							<Table.Cell class="text-ink-muted">{row.timezone}</Table.Cell>
							<Table.Cell class="font-mono text-xs text-ink-muted" title={row.orgRef}
								>{row.orgRef.slice(0, 12)}…</Table.Cell
							>
							<Table.Cell>
								<Badge variant={row.status === 'active' ? 'ok' : 'muted'}>
									<span class="size-1.5 rounded-full bg-current opacity-70"></span>
									{row.status === 'active' ? 'Active' : 'Archived'}
								</Badge>
							</Table.Cell>
							{#if data.canWrite}
								<Table.Cell>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="Edit {row.name}"
										onclick={() => openEdit(row)}><PencilIcon /></Button
									>
								</Table.Cell>
							{/if}
						</Table.Row>
					{:else}
						<Table.Row class="hover:bg-transparent">
							<Table.Cell colspan={data.canWrite ? 6 : 5} class="py-10 text-center text-ink-muted">
								No establishment matches your search.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>
</div>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">
				{editing ? 'Edit establishment' : 'Add establishment'}
			</Dialog.Title>
			<Dialog.Description>
				{editing
					? 'Kind and reference are fixed once an establishment exists.'
					: 'A hotel links to its record in the hotel app by reference; a business is created here.'}
			</Dialog.Description>
		</Dialog.Header>

		<form
			method="POST"
			action={editing ? '?/update' : '?/create'}
			class="space-y-4"
			use:enhance={() => {
				busy = true;
				return async ({ result, update }) => {
					await update({ reset: false });
					busy = false;
					if (result.type === 'success') {
						dialogOpen = false;
						toast.success((result.data as { ok?: string } | undefined)?.ok ?? 'Saved.');
					} else if (result.type === 'failure') {
						const msg = (result.data as { message?: string } | undefined)?.message;
						if (msg) toast.error(msg);
					}
				};
			}}
		>
			{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}

			<div class="space-y-1.5">
				<Label for="name">Name</Label>
				<Input id="name" name="name" required maxlength={120} value={editing?.name ?? ''} />
				{#if fieldError('name')}<p class="text-sm text-destructive">{fieldError('name')}</p>{/if}
			</div>

			{#if !editing}
				<div class="space-y-1.5">
					<Label for="kind">Kind</Label>
					<select id="kind" name="kind" class={selectClass} bind:value={kind}>
						<option value="hotel">Hotel</option>
						<option value="business">Business (HR only)</option>
					</select>
				</div>
				{#if kind === 'hotel'}
					<div class="space-y-1.5">
						<Label for="orgRef">Hotel reference</Label>
						<Input id="orgRef" name="orgRef" placeholder="org_…" class="font-mono" required />
						{#if fieldError('orgRef')}<p class="text-sm text-destructive">{fieldError('orgRef')}</p>{/if}
					</div>
				{/if}
			{/if}

			<div class="space-y-1.5">
				<Label for="legalName">Legal name <span class="text-ink-muted">(printed on DTRs)</span></Label>
				<Input id="legalName" name="legalName" maxlength={160} value={editing?.legalName ?? ''} />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label for="addressLine">Address</Label>
					<Input id="addressLine" name="addressLine" maxlength={200} value={editing?.addressLine ?? ''} />
				</div>
				<div class="space-y-1.5">
					<Label for="city">City</Label>
					<Input id="city" name="city" maxlength={80} value={editing?.city ?? ''} />
				</div>
			</div>

			<div class="space-y-1.5">
				<Label for="timezone">Timezone</Label>
				<select id="timezone" name="timezone" class={selectClass}>
					{#each TIMEZONES as tz (tz)}
						<option value={tz} selected={(editing?.timezone ?? 'Asia/Manila') === tz}>{tz}</option>
					{/each}
				</select>
			</div>

			{#if editing}
				<div class="space-y-1.5">
					<Label for="status">Status</Label>
					<select id="status" name="status" class={selectClass}>
						<option value="active" selected={editing.status === 'active'}>Active</option>
						<option value="archived" selected={editing.status === 'archived'}>Archived</option>
					</select>
				</div>
			{/if}

			<Dialog.Footer class="gap-2 pt-2">
				<Button variant="outline" type="button" onclick={() => (dialogOpen = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
