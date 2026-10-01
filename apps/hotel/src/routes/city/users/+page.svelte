<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<h1 class="mb-6 text-xl font-semibold tracking-tight text-ink">Users</h1>

	{#if form?.inviteLink}
		<p class="mb-4 break-all rounded-xl border border-border bg-surface-2 p-5 text-sm shadow-sm">
			<code>{form.inviteLink}</code>
		</p>
	{/if}

	<div class="grid gap-6 md:grid-cols-[1fr_320px]">
		<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>User</Table.Head>
						<Table.Head>Platform admin</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.users as u (u.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{u.name}</div>
								<div class="text-xs text-ink-muted">{u.email}</div>
							</Table.Cell>
							<Table.Cell>{u.isPlatformAdmin ? 'Yes' : '—'}</Table.Cell>
							<Table.Cell>
								<Badge
									variant="outline"
									class={u.status === 'active'
										? 'border-transparent bg-ok/15 text-ok'
										: 'border-transparent bg-danger/10 text-danger'}
								>
									{u.status}
								</Badge>
							</Table.Cell>
							<Table.Cell>
								<form method="POST" action="?/setStatus" use:enhance>
									<input type="hidden" name="userId" value={u.id} />
									<input
										type="hidden"
										name="status"
										value={u.status === 'active' ? 'disabled' : 'active'}
									/>
									<button class="text-xs text-brand hover:underline">
										{u.status === 'active' ? 'Disable' : 'Enable'}
									</button>
								</form>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</section>

		<section class="h-fit rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">
				Invite platform admin
			</h2>
			<form method="POST" action="?/invitePlatformAdmin" use:enhance class="mt-3 space-y-3">
				<div>
					<Label for="email">Email</Label>
					<Input id="email" name="email" type="email" required class="mt-1" />
				</div>
				<Button type="submit" class="w-full">Create invite</Button>
			</form>
		</section>
	</div>
</div>
