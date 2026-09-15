<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const base = $derived(`/${page.params.hotel}`);

	let roleForms: Record<string, HTMLFormElement> = {};
	let linkForms: Record<string, HTMLFormElement> = {};
	let inviteRole = $state<string>('');

	function linkedEmployeeId(userId: string): string {
		return data.employees.find((e) => e.userId === userId)?.id ?? '';
	}

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});

	function roleName(slug: string): string {
		return data.assignableRoles.find((r) => r.slug === slug)?.name ?? slug;
	}
</script>

<div class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">Team</h1>
			<p class="text-sm text-ink-muted">
				Invite staff to this hotel and manage their roles. Hotel admin access is granted by a
				platform admin, not from here.
			</p>
		</div>
		<div class="flex shrink-0 gap-2">
			<Button variant="outline" href="{base}/settings/team/roles">Manage roles</Button>
			<Button variant="outline" href="{base}/settings">← Settings</Button>
		</div>
	</div>

	{#if form?.inviteLink}
		<p class="mb-4 break-all rounded-xl border border-border bg-surface-2 p-5 text-sm shadow-sm">
			Send this link to the invitee:<br /><code>{form.inviteLink}</code>
		</p>
	{/if}

	<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Members</h2>
		{#if data.members.length === 0}
			<p class="mt-2 text-sm text-ink-muted">No members yet.</p>
		{:else}
			<Table.Root class="mt-2">
				<Table.Body>
					{#each data.members as m (m.userId)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{m.name}</div>
								<div class="text-xs text-ink-muted">{m.email}</div>
							</Table.Cell>
							<Table.Cell>
								{#if m.isProtected}
									<Badge variant="secondary">{m.roleName}</Badge>
								{:else}
									<form
										method="POST"
										action="?/changeRole"
										use:enhance
										bind:this={roleForms[m.userId]}
										class="flex items-center gap-2"
									>
										<input type="hidden" name="userId" value={m.userId} />
										<Select.Root
											type="single"
											name="role"
											value={m.roleSlug}
											onValueChange={() => roleForms[m.userId]?.requestSubmit()}
										>
											<Select.Trigger class="w-40">{m.roleName}</Select.Trigger>
											<Select.Content>
												{#each data.assignableRoles as r (r.id)}
													<Select.Item value={r.slug} label={r.name} />
												{/each}
											</Select.Content>
										</Select.Root>
									</form>
								{/if}
							</Table.Cell>
							<Table.Cell>
								<form
									method="POST"
									action="?/linkEmployee"
									use:enhance
									bind:this={linkForms[m.userId]}
								>
									<input type="hidden" name="userId" value={m.userId} />
									<select
										name="employeeId"
										value={linkedEmployeeId(m.userId)}
										onchange={() => linkForms[m.userId]?.requestSubmit()}
										class="rounded-md border border-input bg-transparent px-2 py-1 text-xs"
									>
										<option value="">— no linked employee —</option>
										{#each data.employees.filter((e) => e.userId == null || e.userId === m.userId) as e (e.id)}
											<option value={e.id}>{e.firstName} {e.lastName} ({e.employeeNo})</option>
										{/each}
									</select>
								</form>
							</Table.Cell>
							<Table.Cell>
								{#if !m.isProtected}
									<form method="POST" action="?/removeMember" use:enhance>
										<input type="hidden" name="userId" value={m.userId} />
										<button class="text-xs text-danger hover:underline">Remove</button>
									</form>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}

		{#if data.pendingInvites.length > 0}
			<h3 class="mt-4 text-xs font-semibold uppercase text-ink-muted">Pending invites</h3>
			<ul class="mt-1 text-sm">
				{#each data.pendingInvites as inv (inv.id)}
					<li class="flex items-center justify-between py-1 text-ink-muted">
						{inv.email} — {roleName(inv.role ?? '')}
						<form method="POST" action="?/revokeInvite" use:enhance>
							<input type="hidden" name="id" value={inv.id} />
							<button class="text-xs text-danger hover:underline">Cancel</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		<Separator class="my-4" />
		<h3 class="text-xs font-semibold uppercase text-ink-muted">Invite a staff member</h3>
		<form method="POST" action="?/inviteMember" use:enhance class="mt-2 space-y-3">
			<div>
				<Label for="inviteEmail">Email</Label>
				<Input id="inviteEmail" name="email" type="email" required class="mt-1" />
			</div>
			<div>
				<Label for="inviteRole">Role</Label>
				<Select.Root type="single" name="role" bind:value={inviteRole}>
					<Select.Trigger id="inviteRole" class="mt-1 w-full">
						{inviteRole ? roleName(inviteRole) : 'Select a role'}
					</Select.Trigger>
					<Select.Content>
						{#each data.assignableRoles as r (r.id)}
							<Select.Item value={r.slug} label={r.name} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<Button type="submit">Create invite</Button>
		</form>
	</section>
</div>
