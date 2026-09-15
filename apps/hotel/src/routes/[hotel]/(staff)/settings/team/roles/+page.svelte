<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}`);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});

	let showCreate = $state(false);
	let editingRoleId = $state<string | null>(null);
</script>

{#snippet permissionGrid(selected: string[])}
	<div class="space-y-4">
		{#each data.sections as section (section)}
			{@const items = data.catalog.filter((c) => c.section === section)}
			<div>
				<p class="text-xs font-semibold uppercase tracking-wide text-ink-muted">{section}</p>
				<div class="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
					{#each items as c (c.cap)}
						<label class="flex items-center gap-2 text-sm text-ink">
							<input
								type="checkbox"
								name="capabilities"
								value={c.cap}
								checked={selected.includes(c.cap)}
								class="size-4"
							/>
							{c.label}
						</label>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{/snippet}

<div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Roles</h1>
			<p class="text-sm text-ink-muted">
				Bundle permissions into a role, then assign it to a team member. Hotel Admin is fixed —
				always full access, so a hotel can never lock itself out.
			</p>
		</div>
		<Button variant="outline" href="{base}/settings/team">← Team</Button>
	</div>

	<div class="space-y-3">
		{#each data.roles as r (r.id)}
			<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<span class="font-medium text-ink">{r.name}</span>
							{#if r.isProtected}
								<Badge variant="secondary">Protected</Badge>
							{/if}
							<span class="text-xs text-ink-muted"
								>{r.memberCount} member{r.memberCount === 1 ? '' : 's'}</span
							>
						</div>
						{#if r.description}
							<p class="mt-0.5 text-sm text-ink-muted">{r.description}</p>
						{/if}
						<p class="mt-1 text-xs text-ink-muted">
							{r.capabilities.includes('*') ? 'Everything' : `${r.capabilities.length} permission${r.capabilities.length === 1 ? '' : 's'}`}
						</p>
					</div>
					{#if !r.isProtected}
						<div class="flex shrink-0 gap-2">
							<Button
								variant="outline"
								size="sm"
								onclick={() => (editingRoleId = editingRoleId === r.id ? null : r.id)}
							>
								{editingRoleId === r.id ? 'Cancel' : 'Edit'}
							</Button>
							<form method="POST" action="?/deleteRole" use:enhance>
								<input type="hidden" name="roleId" value={r.id} />
								<Button
									type="submit"
									variant="outline"
									size="sm"
									class="text-danger hover:text-danger"
									disabled={r.memberCount > 0}
									title={r.memberCount > 0 ? 'Reassign everyone with this role first.' : undefined}
								>
									Delete
								</Button>
							</form>
						</div>
					{/if}
				</div>

				{#if editingRoleId === r.id}
					<form method="POST" action="?/updateRole" use:enhance class="mt-4 space-y-3 border-t border-border pt-4">
						<input type="hidden" name="roleId" value={r.id} />
						<div class="grid gap-3 sm:grid-cols-2">
							<div>
								<Label for="name-{r.id}">Name</Label>
								<Input id="name-{r.id}" name="name" value={r.name} required class="mt-1" />
							</div>
							<div>
								<Label for="desc-{r.id}">Description (optional)</Label>
								<Input id="desc-{r.id}" name="description" value={r.description ?? ''} class="mt-1" />
							</div>
						</div>
						<div>
							<Label>Permissions</Label>
							<div class="mt-2">
								{@render permissionGrid(r.capabilities)}
							</div>
						</div>
						<Button type="submit" size="sm">Save role</Button>
					</form>
				{/if}
			</section>
		{/each}
	</div>

	<div class="mt-6">
		{#if !showCreate}
			<Button onclick={() => (showCreate = true)}>Add role</Button>
		{:else}
			<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
				<h2 class="text-sm font-semibold text-ink">New role</h2>
				<form
					method="POST"
					action="?/createRole"
					use:enhance={() => {
						return async ({ update }) => {
							await update();
							showCreate = false;
						};
					}}
					class="mt-3 space-y-3"
				>
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<Label for="new-name">Name</Label>
							<Input id="new-name" name="name" placeholder="e.g. Cashier" required class="mt-1" />
						</div>
						<div>
							<Label for="new-desc">Description (optional)</Label>
							<Input id="new-desc" name="description" class="mt-1" />
						</div>
					</div>
					<div>
						<Label>Permissions</Label>
						<div class="mt-2">
							{@render permissionGrid([])}
						</div>
					</div>
					<div class="flex gap-2">
						<Button type="submit" size="sm">Create role</Button>
						<Button type="button" variant="outline" size="sm" onclick={() => (showCreate = false)}>
							Cancel
						</Button>
					</div>
				</form>
			</section>
		{/if}
	</div>
</div>
