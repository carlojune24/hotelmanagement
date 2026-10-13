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
	const base = $derived(`/${page.params.hotel}/management`);

	let roleForms: Record<string, HTMLFormElement> = {};
	let inviteRole = $state<string>('');
	let inviteEmail = $state('');
	/** The HR person chosen in the picker; '' when the invite is by email only. */
	let hrRef = $state('');

	function pickHrPerson(ref: string) {
		hrRef = ref;
		const p = data.hr.people.find((x) => x.person_ref === ref);
		// Prefill, never overwrite what the admin already typed by hand.
		if (p?.email && !inviteEmail) inviteEmail = p.email;
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
								<div class="text-xs text-ink-muted">
									{m.email}{#if m.personRef}<span title="Linked to an HR employee record"> · from HR</span>{/if}
								</div>
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
		<form
			method="POST"
			action="?/inviteMember"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'success') {
						inviteEmail = '';
						hrRef = '';
					}
				}}
			class="mt-2 space-y-3"
		>
			{#if data.hr.connected}
				<div>
					<Label for="hrPerson">From HR <span class="text-ink-muted">(optional)</span></Label>
					{#if data.hr.error}
						<p class="mt-1 text-xs text-warning">
							HR can't be reached right now ({data.hr.error}). You can still invite by email.
						</p>
					{:else}
						<select
							id="hrPerson"
							class="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-sm"
							value={hrRef}
							onchange={(e) => pickHrPerson(e.currentTarget.value)}
						>
							<option value="">Not from HR — invite by email</option>
							{#each data.hr.people as p (p.person_ref)}
								<option value={p.person_ref}>
									{p.last_name}, {p.first_name}{p.position ? ` — ${p.position}` : ''}
								</option>
							{/each}
						</select>
						<p class="mt-1 text-xs text-ink-muted">
							People HR has assigned to this hotel who don't have a login yet.
						</p>
					{/if}
					<input type="hidden" name="personRef" value={hrRef} />
				</div>
			{/if}
			<div>
				<Label for="inviteEmail">Email</Label>
				<Input id="inviteEmail" name="email" type="email" required class="mt-1" bind:value={inviteEmail} />
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
