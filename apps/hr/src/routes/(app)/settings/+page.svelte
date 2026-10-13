<script lang="ts">
	import { enhance } from '$app/forms';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const TABS = [
		{ key: 'establishments', label: 'Establishment types' },
		{ key: 'loans', label: 'Loan types' }
	] as const;
	type Tab = (typeof TABS)[number]['key'];
	// The tab lives in the address (?tab=) so a reload or a shared link lands on the same one.
	let tab = $state<Tab>(page.url.searchParams.get('tab') === 'loans' ? 'loans' : 'establishments');
	function pick(next: Tab) {
		tab = next;
		replaceState(`?tab=${next}`, {});
	}

	let adding = $state(false);
	let editingId = $state<string | null>(null);
	let addingEst = $state(false);
	let editingEstId = $state<string | null>(null);
	let busy = $state(false);
	const editingEst = $derived(data.establishmentTypes.find((t) => t.id === editingEstId) ?? null);
	const editing = $derived(data.loanTypes.find((t) => t.id === editingId) ?? null);
	const remitLabel = (v: string) => data.remitOptions.find((o) => o.value === v)?.label ?? v;
	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

	$effect(() => {
		if (form && 'error' in form && form.error) toast.error(form.error);
		else if (form && 'ok' in form && form.ok) {
			toast.success(form.ok);
			adding = false;
			editingId = null;
			addingEst = false;
			editingEstId = null;
		}
	});

	function submit() {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	}
</script>

<svelte:head><title>Settings · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<h1 class="text-5xl font-light tracking-tight">Settings</h1>

	<div class="flex flex-wrap gap-2" role="tablist" aria-label="Settings">
		{#each TABS as t (t.key)}
			<button
				type="button"
				role="tab"
				id="tab-{t.key}"
				aria-selected={tab === t.key}
				aria-controls="panel-{t.key}"
				class="rounded-full px-5 py-2 text-sm font-medium transition-colors {tab === t.key
					? 'bg-ink text-white'
					: 'bg-ink/10 text-ink hover:bg-ink/15'}"
				onclick={() => pick(t.key)}>{t.label}</button
			>
		{/each}
	</div>

	{#if tab === 'establishments'}
	<div id="panel-establishments" role="tabpanel" aria-labelledby="tab-establishments" class="panel space-y-5 p-5 md:p-6" aria-label="Establishment types">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="max-w-2xl">
				<h2 class="text-2xl font-light">Establishment types</h2>
				<p class="mt-1 text-sm text-ink-muted">
					The kinds of establishment you run — Hotel, Restaurant, Retail and so on. Choose one when you add an
					establishment. Only a type marked as linking to the hotel app carries a hotel reference.
				</p>
			</div>
			<Button variant="gold" onclick={() => (addingEst = true)}><PlusIcon /> Add type</Button>
		</div>

		<Table.Root>
			<Table.Header>
				<Table.Row class="hover:bg-transparent">
					<Table.Head>Name</Table.Head>
					<Table.Head>Hotel app link</Table.Head>
					<Table.Head class="text-right">Establishments</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="w-24"><span class="sr-only">Actions</span></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.establishmentTypes as t (t.id)}
					<Table.Row>
						<Table.Cell class="font-medium">{t.name}</Table.Cell>
						<Table.Cell>{t.linksToHotelApp ? 'Links to the hotel app' : 'HR only'}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{t.establishmentCount}</Table.Cell>
						<Table.Cell>
							<Badge variant={t.active ? 'ok' : 'muted'}>
								<span class="size-1.5 rounded-full bg-current opacity-70"></span>
								{t.active ? 'In use' : 'Retired'}
							</Badge>
						</Table.Cell>
						<Table.Cell class="text-right">
							<Button variant="outline" size="sm" onclick={() => (editingEstId = t.id)}>Edit</Button>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
	{:else}
	<div id="panel-loans" role="tabpanel" aria-labelledby="tab-loans" class="panel space-y-5 p-5 md:p-6" aria-label="Loan types">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="max-w-2xl">
				<h2 class="text-2xl font-light">Loan types</h2>
				<p class="mt-1 text-sm text-ink-muted">
					The kinds of loan you can record under Loans. Each type says where its deductions are remitted;
					a type that is not remitted is deducted from pay only.
				</p>
			</div>
			<Button variant="gold" onclick={() => (adding = true)}><PlusIcon /> Add loan type</Button>
		</div>

		<Table.Root>
			<Table.Header>
				<Table.Row class="hover:bg-transparent">
					<Table.Head>Name</Table.Head>
					<Table.Head>Remitted to</Table.Head>
					<Table.Head class="text-right">Loans</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="w-24"><span class="sr-only">Actions</span></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.loanTypes as t (t.id)}
					<Table.Row>
						<Table.Cell class="font-medium">{t.name}</Table.Cell>
						<Table.Cell>{remitLabel(t.remitTo)}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{t.loanCount}</Table.Cell>
						<Table.Cell>
							<Badge variant={t.active ? 'ok' : 'muted'}>
								<span class="size-1.5 rounded-full bg-current opacity-70"></span>
								{t.active ? 'In use' : 'Retired'}
							</Badge>
						</Table.Cell>
						<Table.Cell class="text-right">
							<Button variant="outline" size="sm" onclick={() => (editingId = t.id)}>Edit</Button>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
	{/if}
</div>

<Dialog.Root open={adding} onOpenChange={(o) => (adding = o)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">Add loan type</Dialog.Title>
			<Dialog.Description>It appears in the New loan form straight away.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/createType" use:enhance={submit} class="space-y-3">
			<div class="space-y-1.5">
				<Label for="newName">Name</Label>
				<Input id="newName" name="name" maxlength={80} required />
			</div>
			<div class="space-y-1.5">
				<Label for="newRemit">Remitted to</Label>
				<select id="newRemit" name="remitTo" class={selectClass}>
					{#each data.remitOptions as o (o.value)}<option value={o.value} selected={o.value === 'none'}>{o.label}</option>{/each}
				</select>
			</div>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (adding = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Add</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={editing !== null} onOpenChange={(o) => !o && (editingId = null)}>
	<Dialog.Content class="sm:max-w-md">
		{#if editing}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">{editing.name}</Dialog.Title>
				<Dialog.Description>
					{editing.loanCount} {editing.loanCount === 1 ? 'loan uses' : 'loans use'} this type. Changing where it is
					remitted affects payslips generated from now on, not ones already locked.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/updateType" use:enhance={submit} class="space-y-3">
				<input type="hidden" name="id" value={editing.id} />
				<div class="space-y-1.5">
					<Label for="editName">Name</Label>
					<Input id="editName" name="name" maxlength={80} value={editing.name} required />
				</div>
				<div class="space-y-1.5">
					<Label for="editRemit">Remitted to</Label>
					<select id="editRemit" name="remitTo" class={selectClass}>
						{#each data.remitOptions as o (o.value)}<option value={o.value} selected={o.value === editing.remitTo}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="space-y-1.5">
					<Label for="editActive">Status</Label>
					<select id="editActive" name="active" class={selectClass}>
						<option value="true" selected={editing.active}>In use — can be chosen for new loans</option>
						<option value="false" selected={!editing.active}>Retired — kept on existing loans only</option>
					</select>
				</div>
				<Dialog.Footer class="gap-2 pt-1">
					<Button type="button" variant="outline" onclick={() => (editingId = null)}>Cancel</Button>
					<Button type="submit" disabled={busy}>Save</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={addingEst} onOpenChange={(o) => (addingEst = o)}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="font-display text-2xl font-light">Add establishment type</Dialog.Title>
			<Dialog.Description>It appears in the Add establishment form straight away.</Dialog.Description>
		</Dialog.Header>
		<form method="POST" action="?/createEstType" use:enhance={submit} class="space-y-3">
			<div class="space-y-1.5">
				<Label for="estTypeName">Name</Label>
				<Input id="estTypeName" name="name" maxlength={60} required />
			</div>
			<label class="flex items-start gap-2 text-sm">
				<input type="checkbox" name="linksToHotelApp" class="mt-0.5 size-4 accent-black" />
				<span>
					Links to the hotel app
					<span class="block text-xs text-ink-muted">
						For a hotel that is also set up in the hotel app. It cannot be changed later.
					</span>
				</span>
			</label>
			<Dialog.Footer class="gap-2 pt-1">
				<Button type="button" variant="outline" onclick={() => (addingEst = false)}>Cancel</Button>
				<Button type="submit" disabled={busy}>Add</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={editingEst !== null} onOpenChange={(o) => !o && (editingEstId = null)}>
	<Dialog.Content class="sm:max-w-md">
		{#if editingEst}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">{editingEst.name}</Dialog.Title>
				<Dialog.Description>
					{editingEst.establishmentCount}
					{editingEst.establishmentCount === 1 ? 'establishment uses' : 'establishments use'} this type. Retiring it
					only hides it from the Add form.
				</Dialog.Description>
			</Dialog.Header>
			<form method="POST" action="?/updateEstType" use:enhance={submit} class="space-y-3">
				<input type="hidden" name="id" value={editingEst.id} />
				<div class="space-y-1.5">
					<Label for="estEditName">Name</Label>
					<Input id="estEditName" name="name" maxlength={60} value={editingEst.name} required />
				</div>
				<div class="space-y-1.5">
					<Label for="estEditActive">Status</Label>
					<select id="estEditActive" name="active" class={selectClass}>
						<option value="true" selected={editingEst.active}>In use — can be chosen for new establishments</option>
						<option value="false" selected={!editingEst.active}>Retired — kept on existing establishments only</option>
					</select>
				</div>
				<Dialog.Footer class="gap-2 pt-1">
					<Button type="button" variant="outline" onclick={() => (editingEstId = null)}>Cancel</Button>
					<Button type="submit" disabled={busy}>Save</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
