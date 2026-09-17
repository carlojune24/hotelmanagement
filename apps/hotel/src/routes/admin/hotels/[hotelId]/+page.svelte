<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const h = $derived(data.hotel);

	$effect(() => {
		if (form?.error) toast.error(form.error);
		if (form?.ok) toast.success(form.ok);
	});
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-xl font-semibold tracking-tight text-ink">{h.name}</h1>
			<p class="text-sm text-ink-muted">
				<code>/{h.slug}</code> · {h.status} · org <code class="text-xs">{h.orgRef}</code>
			</p>
			<p class="mt-1 text-sm">
				<a
					href="/{h.slug}/management/login"
					target="_blank"
					rel="noopener"
					class="text-brand hover:underline"
				>
					Open management sign-in →
				</a>
			</p>
		</div>
		<Button variant="outline" href="/admin/hotels">← All hotels</Button>
	</div>

	{#if form?.inviteLink}
		<p class="mb-4 break-all rounded-xl border border-border bg-surface-2 p-5 text-sm shadow-sm">
			Send this link to the invitee:<br /><code>{form.inviteLink}</code>
		</p>
	{/if}

	<div class="grid gap-6 lg:grid-cols-2">
		<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Configuration</h2>
			<form method="POST" action="?/updateConfig" use:enhance class="mt-3 space-y-3">
				<div>
					<Label for="name">Name</Label>
					<Input id="name" name="name" value={h.name} required class="mt-1" />
				</div>
				<p class="text-xs text-ink-muted">
					Legal name, address, timezone, currency, and VAT rate are set by the hotel's own admin,
					under Finance settings and BIR setup.
				</p>
				<div>
					<Label for="customDomain">Custom domain (optional)</Label>
					<Input
						id="customDomain"
						name="customDomain"
						value={h.customDomain ?? ''}
						placeholder="mmhotel.com"
						class="mt-1"
					/>
					<p class="mt-1 text-xs text-ink-muted">
						Point this domain's DNS at this platform, then enter it here — bare hostname only, no
						<code>https://</code> or trailing path. DNS/hosting setup for the domain itself happens
						outside this app.
					</p>
				</div>
				<Button type="submit">Save configuration</Button>
			</form>

			<Separator class="my-4" />
			<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">URL slug</h2>
			<form method="POST" action="?/updateSlug" use:enhance class="mt-3 space-y-3">
				<div>
					<Label for="slug">Slug</Label>
					<Input
						id="slug"
						name="slug"
						value={h.slug}
						required
						pattern="[a-z0-9][a-z0-9-]&#123;1,38&#125;[a-z0-9]"
						class="mt-1"
					/>
					<p class="mt-1 text-xs text-danger">
						Changes this hotel's URL to /{'{new-slug}'} everywhere. Any confirmation,
						manage-booking, or review links already emailed to guests under <code>/{h.slug}</code> will
						stop working — rename with care, especially after launch.
					</p>
				</div>
				<Button type="submit" variant="outline">Update slug</Button>
			</form>

			<Separator class="my-4" />
			<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Status</h2>
			<div class="mt-2 flex gap-2">
				<form method="POST" action="?/setStatus" use:enhance>
					<input type="hidden" name="status" value="published" />
					<Button type="submit" disabled={h.status === 'published'}>Publish</Button>
				</form>
				<form method="POST" action="?/setStatus" use:enhance>
					<input type="hidden" name="status" value="draft" />
					<Button variant="outline" type="submit" disabled={h.status === 'draft'}>Unpublish</Button>
				</form>
				<form method="POST" action="?/setStatus" use:enhance>
					<input type="hidden" name="status" value="archived" />
					<Button variant="destructive" type="submit" disabled={h.status === 'archived'}>
						Archive
					</Button>
				</form>
			</div>
		</section>

		<section class="rounded-xl border border-border bg-surface-2 p-5 shadow-sm">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-ink-muted">Hotel admins</h2>
			<p class="mt-1 text-xs text-ink-muted">
				Platform admin only grants/revokes <code>hotel_admin</code> access here. Everything else
				— front desk, housekeeping, accountant, HR, and other staff — is invited by a hotel's
				own admin from inside the hotel's Team settings.
			</p>
			{#if data.members.length === 0}
				<p class="mt-2 text-sm text-ink-muted">No hotel admins yet.</p>
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
									<form method="POST" action="?/removeMember" use:enhance>
										<input type="hidden" name="userId" value={m.userId} />
										<button class="text-xs text-danger hover:underline">Remove</button>
									</form>
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
							{inv.email}
							<form method="POST" action="?/revokeInvite" use:enhance>
								<input type="hidden" name="id" value={inv.id} />
								<button class="text-xs text-danger hover:underline">Cancel</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}

			<Separator class="my-4" />
			<h3 class="text-xs font-semibold uppercase text-ink-muted">Invite a hotel admin</h3>
			<form method="POST" action="?/inviteMember" use:enhance class="mt-2 space-y-3">
				<div>
					<Label for="inviteEmail">Email</Label>
					<Input id="inviteEmail" name="email" type="email" required class="mt-1" />
				</div>
				<Button type="submit">Create invite</Button>
			</form>
		</section>
	</div>
</div>
