<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import KeyIcon from '@lucide/svelte/icons/key-round';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { ABILITY_ROWS, ESTABLISHMENT_ROLES, ORG_ROLES, ROLE_LABEL, ROLE_SUMMARY, can, type Role } from '$lib/authz';
	import { MIN_PASSWORD, isOrgRole } from '$lib/user-schema';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	type Row = PageData['users'][number];

	let dialog = $state<'none' | 'create' | 'edit' | 'reset'>('none');
	let target = $state<Row | null>(null);
	let role = $state<Role>('business_manager');
	let busy = $state(false);

	const open = $derived(dialog !== 'none');
	const scoped = $derived(!isOrgRole(role));
	const fieldError = (name: string): string | undefined =>
		(form as { errors?: Record<string, string[] | undefined> } | null)?.errors?.[name]?.[0];
	const selectClass =
		'h-10 w-full rounded-full border border-transparent bg-white px-4 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

	function openCreate() {
		target = null;
		role = 'business_manager';
		dialog = 'create';
	}
	function openEdit(row: Row) {
		target = row;
		role = (row.role ?? 'business_manager') as Role;
		dialog = 'edit';
	}
	function openReset(row: Row) {
		target = row;
		dialog = 'reset';
	}
	const ALL_ROLES: Role[] = [...ORG_ROLES, ...ESTABLISHMENT_ROLES];
	const roleLabel = (r: string | null) => (r ? (ROLE_LABEL[r as Role] ?? r) : 'No access');
</script>

<svelte:head><title>Users · HR</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<h1 class="text-5xl font-light tracking-tight">Users</h1>

	<section class="panel space-y-5 p-5 md:p-6" aria-label="Users">
		<div class="flex items-center justify-between gap-3">
			<p class="text-sm text-ink-muted">
				Who can sign in to HR, and which establishments each person can see.
			</p>
			<Button variant="gold" onclick={openCreate}><PlusIcon /> Add user</Button>
		</div>

		<Table.Root>
			<Table.Header>
				<Table.Row class="hover:bg-transparent">
					<Table.Head>Name</Table.Head>
					<Table.Head>Role</Table.Head>
					<Table.Head>Establishments</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="w-24"><span class="sr-only">Actions</span></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.users as u (u.id)}
					<Table.Row>
						<Table.Cell>
							<p class="font-medium">{u.name}{u.id === data.selfId ? ' (you)' : ''}</p>
							<p class="text-xs text-ink-muted">{u.email}</p>
						</Table.Cell>
						<Table.Cell>{roleLabel(u.role)}</Table.Cell>
						<Table.Cell class="text-ink-muted">
							{#if u.role && isOrgRole(u.role)}
								All
							{:else if u.establishments.length}
								{u.establishments.map((e) => e.name).join(', ')}
							{:else}
								—
							{/if}
						</Table.Cell>
						<Table.Cell>
							<Badge variant={u.status === 'active' ? 'ok' : 'muted'}>
								<span class="size-1.5 rounded-full bg-current opacity-70"></span>
								{u.status === 'active' ? 'Active' : 'Disabled'}
							</Badge>
						</Table.Cell>
						<Table.Cell>
							<div class="flex justify-end gap-1">
								<Button variant="ghost" size="icon-sm" aria-label="Edit {u.name}" onclick={() => openEdit(u)}
									><PencilIcon /></Button
								>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Reset password for {u.name}"
									onclick={() => openReset(u)}><KeyIcon /></Button
								>
							</div>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</section>

	<section class="panel space-y-4 p-5 md:p-6" aria-label="What each role can do">
		<div>
			<h2 class="text-2xl font-light">What each role can do</h2>
			<p class="mt-1 text-sm text-ink-muted">
				Pick the role by what the person needs to do. A manager or clerk only ever sees the establishments
				you tick for them.
			</p>
		</div>
		<div class="overflow-x-auto">
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>Can they…</Table.Head>
						{#each ALL_ROLES as r (r)}
							<Table.Head class="text-center">{ROLE_LABEL[r]}</Table.Head>
						{/each}
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each ABILITY_ROWS as row (row.cap)}
						<Table.Row>
							<Table.Cell>{row.label}</Table.Cell>
							{#each ALL_ROLES as r (r)}
								<Table.Cell class="text-center">
									{#if can(r, row.cap)}
										<span class="font-medium" aria-label="Yes">Yes</span>
									{:else}
										<span class="text-ink-muted" aria-label="No">—</span>
									{/if}
								</Table.Cell>
							{/each}
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
		<dl class="grid gap-3 text-sm md:grid-cols-2">
			{#each ALL_ROLES as r (r)}
				<div>
					<dt class="font-medium">{ROLE_LABEL[r]}</dt>
					<dd class="text-ink-muted">{ROLE_SUMMARY[r]}</dd>
				</div>
			{/each}
		</dl>
	</section>
</div>

<Dialog.Root
	{open}
	onOpenChange={(o) => {
		if (!o) dialog = 'none';
	}}
>
	<Dialog.Content>
		{#if dialog === 'reset' && target}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">Reset password</Dialog.Title>
				<Dialog.Description>
					Set a new password for {target.name}. They are signed out everywhere and should change it
					after signing in.
				</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action="?/resetPassword"
				class="space-y-4"
				use:enhance={() => {
					busy = true;
					return async ({ result, update }) => {
						await update({ reset: true });
						busy = false;
						if (result.type === 'success') {
							dialog = 'none';
							toast.success('Password reset.');
						} else if (result.type === 'failure') {
							const m = (result.data as { message?: string } | undefined)?.message;
							if (m) toast.error(m);
						}
					};
				}}
			>
				<input type="hidden" name="id" value={target.id} />
				<div class="space-y-1.5">
					<Label for="resetPassword">New password</Label>
					<Input id="resetPassword" name="password" type="password" autocomplete="new-password" minlength={MIN_PASSWORD} required />
					{#if fieldError('password')}<p class="text-sm text-destructive">{fieldError('password')}</p>{/if}
				</div>
				<Dialog.Footer class="gap-2 pt-2">
					<Button variant="outline" type="button" onclick={() => (dialog = 'none')}>Cancel</Button>
					<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</Button>
				</Dialog.Footer>
			</form>
		{:else}
			<Dialog.Header>
				<Dialog.Title class="font-display text-2xl font-light">
					{dialog === 'edit' ? 'Edit user' : 'Add user'}
				</Dialog.Title>
				<Dialog.Description>
					Main HR sees every establishment. A manager or clerk sees only the ones you tick.
				</Dialog.Description>
			</Dialog.Header>
			<form
				method="POST"
				action={dialog === 'edit' ? '?/update' : '?/create'}
				class="space-y-4"
				use:enhance={() => {
					busy = true;
					return async ({ result, update }) => {
						await update({ reset: false });
						busy = false;
						if (result.type === 'success') {
							dialog = 'none';
							toast.success((result.data as { ok?: string } | undefined)?.ok ?? 'Saved.');
						} else if (result.type === 'failure') {
							const m = (result.data as { message?: string } | undefined)?.message;
							if (m) toast.error(m);
						}
					};
				}}
			>
				{#if dialog === 'edit' && target}<input type="hidden" name="id" value={target.id} />{/if}

				<div class="space-y-1.5">
					<Label for="uName">Name</Label>
					<Input id="uName" name="name" required maxlength={120} value={target?.name ?? ''} />
					{#if fieldError('name')}<p class="text-sm text-destructive">{fieldError('name')}</p>{/if}
				</div>

				{#if dialog === 'create'}
					<div class="space-y-1.5">
						<Label for="uEmail">Email</Label>
						<Input id="uEmail" name="email" type="email" autocomplete="off" required />
						{#if fieldError('email')}<p class="text-sm text-destructive">{fieldError('email')}</p>{/if}
					</div>
					<div class="space-y-1.5">
						<Label for="uPassword">Initial password</Label>
						<Input id="uPassword" name="password" type="password" autocomplete="new-password" minlength={MIN_PASSWORD} required />
						<p class="text-xs text-ink-muted">
							At least {MIN_PASSWORD} characters. Share it privately; they can change it after signing in.
						</p>
						{#if fieldError('password')}<p class="text-sm text-destructive">{fieldError('password')}</p>{/if}
					</div>
				{/if}

				<div class="space-y-1.5">
					<Label for="uRole">Role</Label>
					<select id="uRole" name="role" class={selectClass} bind:value={role}>
						<optgroup label="Whole organization">
							{#each ORG_ROLES as r (r)}<option value={r}>{ROLE_LABEL[r]}</option>{/each}
						</optgroup>
						<optgroup label="Specific establishments">
							{#each ESTABLISHMENT_ROLES as r (r)}<option value={r}>{ROLE_LABEL[r]}</option>{/each}
						</optgroup>
					</select>
					<p class="text-xs text-ink-muted">{ROLE_SUMMARY[role]}</p>
				</div>

				{#if scoped}
					<fieldset class="space-y-2">
						<legend class="text-sm font-medium">Establishments</legend>
						{#if data.establishments.length === 0}
							<p class="text-sm text-ink-muted">Add an establishment first.</p>
						{/if}
						{#each data.establishments as e (e.id)}
							<label class="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									name="establishmentIds"
									value={e.id}
									checked={target?.establishments.some((x) => x.id === e.id) ?? false}
									class="size-4 accent-black"
								/>
								{e.name}
								{#if e.status === 'archived'}<span class="text-xs text-ink-muted">(archived)</span>{/if}
							</label>
						{/each}
						{#if fieldError('establishmentIds')}
							<p class="text-sm text-destructive">{fieldError('establishmentIds')}</p>
						{/if}
					</fieldset>
				{/if}

				{#if dialog === 'edit'}
					<div class="space-y-1.5">
						<Label for="uStatus">Status</Label>
						<select id="uStatus" name="status" class={selectClass}>
							<option value="active" selected={target?.status === 'active'}>Active</option>
							<option value="disabled" selected={target?.status === 'disabled'}>Disabled</option>
						</select>
					</div>
				{/if}

				<Dialog.Footer class="gap-2 pt-2">
					<Button variant="outline" type="button" onclick={() => (dialog = 'none')}>Cancel</Button>
					<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
